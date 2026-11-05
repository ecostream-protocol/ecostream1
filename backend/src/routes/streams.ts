import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import type { Stream } from '@prisma/client';
import { prisma } from '../db';
import { config, demoMode } from '../config';
import { carbonKgFor, computeLiveStreamed, fromStroops, toStroops } from '../metrics';
import {
  addressArg,
  assertSource,
  buildInvokeXdr,
  i128Arg,
  invokeAsOracle,
  submitSignedXdr,
  u64Arg,
} from '../stellar';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

const address = z.string().regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key');
const startSchema = z
  .object({
    userAddress: address,
    ratePerSecond: z.number().positive().max(1000),
    deposit: z.number().positive().max(1_000_000_000),
  })
  .refine((v) => toStroops(v.ratePerSecond) >= 1n, { message: 'Rate is below 1 stroop per second' })
  .refine((v) => v.deposit >= v.ratePerSecond, { message: 'Deposit must cover at least one second' });

const xdrBody = z.object({ signedXdr: z.string().min(10).optional() });

export function serialize(s: Stream, nowMs = Date.now()) {
  const live = computeLiveStreamed(s, nowMs);
  return {
    id: s.id,
    userAddress: s.userAddress,
    ratePerSecond: s.ratePerSecond,
    deposit: s.deposit,
    totalStreamed: live,
    carbonKg: carbonKgFor(live, config.kgPerUsdc),
    status: s.status,
    mode: s.mode,
    contractStreamId: s.contractStreamId,
    txHash: s.txHash,
    createdAt: s.createdAt.toISOString(),
    activatedAt: s.activatedAt?.toISOString() ?? null,
    closedAt: s.closedAt?.toISOString() ?? null,
  };
}

async function getStream(id: string): Promise<Stream> {
  const s = await prisma.stream.findUnique({ where: { id } });
  if (!s) throw new HttpError(404, 'Stream not found');
  return s;
}

async function logOffset(streamId: string, usdc: number) {
  if (usdc <= 0) return;
  await prisma.offsetLog.create({
    data: { streamId, usdcAmount: usdc, carbonKgSaved: carbonKgFor(usdc, config.kgPerUsdc) },
  });
}

/** Settles accrued value (oracle withdraw on-chain, or local accounting in demo mode). */
export async function settleStream(id: string) {
  const s = await getStream(id);
  if (s.status !== 'ACTIVE') throw new HttpError(409, 'Stream is not active');
  let delta: number;
  let txHash = s.txHash;
  if (demoMode || s.mode !== 'chain' || s.contractStreamId == null) {
    delta = Math.max(0, computeLiveStreamed(s, Date.now()) - s.totalStreamed);
  } else {
    const res = await invokeAsOracle('withdraw_stream', [u64Arg(s.contractStreamId)]);
    delta = fromStroops(res.returnValue as bigint);
    txHash = res.hash;
  }
  const totalStreamed = Math.min(s.deposit, s.totalStreamed + delta);
  const depleted = totalStreamed >= s.deposit - 1e-7;
  const updated = await prisma.stream.update({
    where: { id },
    data: {
      totalStreamed,
      txHash,
      status: depleted ? 'CLOSED' : 'ACTIVE',
      closedAt: depleted ? new Date() : null,
    },
  });
  await logOffset(id, delta);
  return updated;
}

const router = Router();

router.post(
  '/start',
  wrap(async (req, res) => {
    const body = startSchema.parse(req.body);
    const chain = !demoMode;
    const stream = await prisma.stream.create({
      data: {
        userAddress: body.userAddress,
        ratePerSecond: body.ratePerSecond,
        deposit: body.deposit,
        mode: chain ? 'chain' : 'demo',
        status: chain ? 'PENDING' : 'ACTIVE',
        activatedAt: chain ? null : new Date(),
      },
    });
    let xdrToSign: string | null = null;
    if (chain) {
      try {
        xdrToSign = await buildInvokeXdr(body.userAddress, 'start_stream', [
          addressArg(body.userAddress),
          i128Arg(toStroops(body.ratePerSecond)),
          i128Arg(toStroops(body.deposit)),
        ]);
      } catch (err) {
        await prisma.stream.delete({ where: { id: stream.id } });
        throw err;
      }
    }
    res.status(201).json({ stream: serialize(stream), xdr: xdrToSign });
  }),
);

router.post(
  '/:id/confirm',
  wrap(async (req, res) => {
    const { signedXdr } = xdrBody.parse(req.body);
    if (!signedXdr) throw new HttpError(400, 'signedXdr is required');
    const s = await getStream(String(req.params.id));
    if (s.status !== 'PENDING') throw new HttpError(409, 'Stream is not pending');
    assertSource(signedXdr, s.userAddress);
    const result = await submitSignedXdr(signedXdr);
    const updated = await prisma.stream.update({
      where: { id: s.id },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        contractStreamId: Number(result.returnValue),
        txHash: result.hash,
      },
    });
    res.json({ stream: serialize(updated) });
  }),
);

router.post(
  '/:id/settle',
  wrap(async (req, res) => {
    const updated = await settleStream(String(req.params.id));
    res.json({ stream: serialize(updated) });
  }),
);

router.post(
  '/:id/stop',
  wrap(async (req, res) => {
    const { signedXdr } = xdrBody.parse(req.body ?? {});
    const s = await getStream(String(req.params.id));
    if (s.status !== 'ACTIVE') throw new HttpError(409, 'Stream is not active');

    let finalStreamed: number;
    let txHash = s.txHash;
    if (!demoMode && s.mode === 'chain' && s.contractStreamId != null) {
      if (!signedXdr) {
        const unsigned = await buildInvokeXdr(s.userAddress, 'close_stream', [u64Arg(s.contractStreamId)]);
        return res.json({ xdr: unsigned });
      }
      assertSource(signedXdr, s.userAddress);
      const result = await submitSignedXdr(signedXdr);
      finalStreamed = Math.max(s.totalStreamed, s.deposit - fromStroops(result.returnValue as bigint));
      txHash = result.hash;
    } else {
      finalStreamed = computeLiveStreamed(s, Date.now());
    }

    const updated = await prisma.stream.update({
      where: { id: s.id },
      data: { status: 'CLOSED', closedAt: new Date(), totalStreamed: finalStreamed, txHash },
    });
    await logOffset(s.id, finalStreamed - s.totalStreamed);
    res.json({ stream: serialize(updated) });
  }),
);

router.get(
  '/:address',
  wrap(async (req, res) => {
    const addr = address.parse(req.params.address);
    const now = Date.now();
    const rows = await prisma.stream.findMany({
      where: { userAddress: addr, status: { not: 'PENDING' } },
      orderBy: { createdAt: 'desc' },
    });
    const streams = rows.map((s) => serialize(s, now));
    const active = streams.filter((s) => s.status === 'ACTIVE');
    const totalStreamedUsdc = streams.reduce((sum, s) => sum + s.totalStreamed, 0);
    const offsets = await prisma.offsetLog.findMany({
      where: { stream: { userAddress: addr } },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });
    res.json({
      address: addr,
      serverTime: new Date(now).toISOString(),
      summary: {
        activeStreams: active.length,
        totalStreamedUsdc,
        carbonKgOffset: carbonKgFor(totalStreamedUsdc, config.kgPerUsdc),
        activeRatePerSecond: active.reduce((sum, s) => sum + s.ratePerSecond, 0),
      },
      streams,
      offsets: offsets.map((o) => ({
        id: o.id,
        streamId: o.streamId,
        carbonKgSaved: o.carbonKgSaved,
        usdcAmount: o.usdcAmount,
        timestamp: o.timestamp.toISOString(),
      })),
    });
  }),
);

export default router;
