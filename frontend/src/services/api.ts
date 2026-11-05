const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface Health {
  ok: boolean;
  mode: 'demo' | 'chain';
  network: 'testnet' | 'mainnet';
  networkPassphrase: string;
  contractId: string | null;
  kgPerUsdc: number;
}

export interface StreamDto {
  id: string;
  userAddress: string;
  ratePerSecond: number;
  deposit: number;
  totalStreamed: number;
  carbonKg: number;
  status: 'PENDING' | 'ACTIVE' | 'CLOSED';
  mode: 'demo' | 'chain';
  contractStreamId: number | null;
  txHash: string | null;
  createdAt: string;
  activatedAt: string | null;
  closedAt: string | null;
}

export interface OffsetDto {
  id: string;
  streamId: string;
  carbonKgSaved: number;
  usdcAmount: number;
  timestamp: string;
}

export interface Metrics {
  address: string;
  serverTime: string;
  summary: {
    activeStreams: number;
    totalStreamedUsdc: number;
    carbonKgOffset: number;
    activeRatePerSecond: number;
  };
  streams: StreamDto[];
  offsets: OffsetDto[];
}

export interface StartInput {
  userAddress: string;
  ratePerSecond: number;
  deposit: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const api = {
  health: () => request<Health>('/api/health'),
  getMetrics: (address: string) => request<Metrics>(`/api/streams/${address}`),
  startStream: (input: StartInput) =>
    post<{ stream: StreamDto; xdr: string | null }>('/api/streams/start', input),
  confirmStream: (id: string, signedXdr: string) =>
    post<{ stream: StreamDto }>(`/api/streams/${id}/confirm`, { signedXdr }),
  settleStream: (id: string) => post<{ stream: StreamDto }>(`/api/streams/${id}/settle`),
  stopStream: (id: string, signedXdr?: string) =>
    post<{ stream?: StreamDto; xdr?: string }>(`/api/streams/${id}/stop`, signedXdr ? { signedXdr } : {}),
};
