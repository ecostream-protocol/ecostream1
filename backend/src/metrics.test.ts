import { describe, expect, it } from 'vitest';
import { carbonKgFor, computeLiveStreamed, fromStroops, toStroops } from './metrics';

const base = {
  status: 'ACTIVE',
  ratePerSecond: 0.0001,
  deposit: 10,
  totalStreamed: 0,
  activatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('metrics', () => {
  it('converts USDC to stroops and back', () => {
    expect(toStroops(0.36)).toBe(3_600_000n);
    expect(fromStroops(3_600_000n)).toBeCloseTo(0.36);
  });

  it('accrues by elapsed seconds', () => {
    const now = base.activatedAt.getTime() + 3_600_000;
    expect(computeLiveStreamed(base, now)).toBeCloseTo(0.36);
  });

  it('caps accrual at the deposit', () => {
    const now = base.activatedAt.getTime() + 10 * 365 * 86_400_000;
    expect(computeLiveStreamed(base, now)).toBe(10);
  });

  it('returns settled total for closed streams', () => {
    expect(computeLiveStreamed({ ...base, status: 'CLOSED', totalStreamed: 4.2 }, Date.now())).toBe(4.2);
  });

  it('computes carbon offsets', () => {
    expect(carbonKgFor(0.36, 25)).toBe(9);
  });
});
