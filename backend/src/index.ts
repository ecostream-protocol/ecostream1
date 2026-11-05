import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config, demoMode } from './config';
import { prisma } from './db';
import { networkPassphrase } from './stellar';
import streams, { HttpError, settleStream } from './routes/streams';

const app = express();
app.use(cors({ origin: config.corsOrigin.split(',') }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    mode: demoMode ? 'demo' : 'chain',
    network: config.network,
    networkPassphrase,
    contractId: config.contractId || null,
    kgPerUsdc: config.kgPerUsdc,
  });
});

app.use('/api/streams', streams);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => i.message).join('; ') });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[error]', err);
  return res.status(500).json({ error: message });
});

const server = app.listen(config.port, () => {
  console.log(`EcoStream API on :${config.port} (${demoMode ? 'DEMO' : 'CHAIN'} mode, ${config.network})`);
});

if (config.autoSettleMs > 0) {
  setInterval(async () => {
    const active = await prisma.stream.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const { id } of active) {
      try {
        await settleStream(id);
      } catch (err) {
        console.error(`[auto-settle] ${id}`, err instanceof Error ? err.message : err);
      }
    }
  }, config.autoSettleMs);
}

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
