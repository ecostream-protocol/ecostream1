export const STROOPS = 10_000_000;

export const toStroops = (usdc: number): bigint => BigInt(Math.round(usdc * STROOPS));
export const fromStroops = (v: bigint | number): number => Number(v) / STROOPS;

export const carbonKgFor = (usdc: number, kgPerUsdc: number): number =>
  Math.round(usdc * kgPerUsdc * 1000) / 1000;

export interface LiveStreamInput {
  status: string;
  ratePerSecond: number;
  deposit: number;
  totalStreamed: number;
  activatedAt: Date | null;
}

/** Streamed USDC at `nowMs`: settled amount or elapsed accrual, whichever is higher, capped at the deposit. */
export function computeLiveStreamed(s: LiveStreamInput, nowMs: number): number {
  if (s.status !== 'ACTIVE' || !s.activatedAt) return s.totalStreamed;
  const elapsed = Math.max(0, (nowMs - s.activatedAt.getTime()) / 1000);
  const accrued = s.ratePerSecond * elapsed;
  return Math.min(s.deposit, Math.max(s.totalStreamed, accrued));
}
