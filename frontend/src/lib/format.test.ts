import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtUsdc, hourlyToPerSecond, truncateAddress } from './format';

describe('format', () => {
  it('truncates addresses', () => {
    const a = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
    expect(truncateAddress(a)).toBe(`${a.slice(0, 5)}…${a.slice(-5)}`);
  });

  it('formats durations', () => {
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(125)).toBe('2m 5s');
    expect(fmtDuration(3 * 3600 + 120)).toBe('3h 2m');
    expect(fmtDuration(2 * 86_400 + 5 * 3600)).toBe('2d 5h');
    expect(fmtDuration(0)).toBe('0s');
  });

  it('formats USDC', () => {
    expect(fmtUsdc(1234.5, 2)).toBe('1,234.50');
  });

  it('converts hourly rate to per-second', () => {
    expect(hourlyToPerSecond(0.36)).toBe(0.0001);
  });
});
