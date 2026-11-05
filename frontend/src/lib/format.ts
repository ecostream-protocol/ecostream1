export const truncateAddress = (a: string, head = 5, tail = 5): string =>
  a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;

export const fmtUsdc = (n: number, digits = 4): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtKg = (n: number, digits = 3): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Human readable duration from seconds, e.g. "2d 4h" or "35m". */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Converts a USDC-per-hour rate to USDC per second, rounded to Stellar's 7 decimals. */
export const hourlyToPerSecond = (perHour: number): number =>
  Math.round((perHour / 3600) * 1e7) / 1e7;
