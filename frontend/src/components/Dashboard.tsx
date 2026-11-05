import { CircleStop, Cloud, Coins, Droplets, Loader2, ReceiptText, Waves } from 'lucide-react';
import type { Metrics, StreamDto } from '../services/api';
import { fmtDuration, fmtKg, fmtUsdc } from '../lib/format';

interface Props {
  metrics: Metrics | null;
  /** performance.now() timestamp of the moment `metrics` was fetched */
  fetchedAt: number;
  /** ticking clock (performance.now) so counters re-render continuously */
  now: number;
  kgPerUsdc: number;
  busyId: string | null;
  onSettle: (id: string) => void;
  onStop: (id: string) => void;
}

/** Live streamed amount: server snapshot plus local accrual since it was fetched. */
export function liveStreamed(s: StreamDto, fetchedAt: number, now: number): number {
  if (s.status !== 'ACTIVE') return s.totalStreamed;
  const extra = (s.ratePerSecond * Math.max(0, now - fetchedAt)) / 1000;
  return Math.min(s.deposit, s.totalStreamed + extra);
}

function StreamLine({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 600 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden>
      <path d="M0 12 C 100 2, 200 22, 300 12 S 500 2, 600 12" fill="none" stroke="rgb(30 41 59)" strokeWidth="2" />
      <path
        d="M0 12 C 100 2, 200 22, 300 12 S 500 2, 600 12"
        fill="none"
        stroke="rgb(52 211 153)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="6 42"
        className={active ? 'animate-flow' : ''}
        opacity={active ? 1 : 0.25}
      />
    </svg>
  );
}

export default function Dashboard({ metrics, fetchedAt, now, kgPerUsdc, busyId, onSettle, onStop }: Props) {
  const streams = metrics?.streams ?? [];
  const active = streams.filter((s) => s.status === 'ACTIVE');
  const totalUsdc = streams.reduce((sum, s) => sum + liveStreamed(s, fetchedAt, now), 0);
  const totalKg = totalUsdc * kgPerUsdc;
  const perHour = active.reduce((sum, s) => sum + s.ratePerSecond * 3600, 0);

  return (
    <section className="space-y-6" aria-label="Carbon offset dashboard">
      <div className="glass-hero p-6 sm:p-8">
        <p className="text-sm text-emerald-300/90">CO₂ offset so far</p>
        <p className="num mt-1 text-5xl font-bold tracking-tight sm:text-7xl">
          {fmtKg(totalKg)}
          <span className="ml-2 text-xl font-medium text-slate-400 sm:text-2xl">kg</span>
        </p>
        <div className="mt-4">
          <StreamLine active={active.length > 0} />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          {active.length > 0
            ? `Adding ${fmtKg((perHour * kgPerUsdc) / 3600, 4)} kg every second from ${active.length} running stream${
                active.length === 1 ? '' : 's'
              }.`
            : 'No stream is running. Start one to begin retiring carbon credits.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<Waves size={18} />} label="Active streams" value={String(active.length)} />
        <Stat icon={<Coins size={18} />} label="USDC streamed" value={fmtUsdc(totalUsdc, 4)} />
        <Stat icon={<Droplets size={18} />} label="Current rate" value={`${fmtUsdc(perHour, 4)} USDC/h`} />
      </div>

      <div className="glass p-5 sm:p-6">
        <h2 className="text-lg font-bold">Your streams</h2>
        {streams.length === 0 ? (
          <p className="mt-3 text-slate-400">Nothing here yet. Set a rate and deposit on the right to start your first stream.</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/5">
            {streams.map((s) => {
              const streamed = liveStreamed(s, fetchedAt, now);
              const pct = s.deposit > 0 ? Math.min(100, (streamed / s.deposit) * 100) : 0;
              const remaining = s.ratePerSecond > 0 ? (s.deposit - streamed) / s.ratePerSecond : 0;
              const busy = busyId === s.id;
              return (
                <li key={s.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        Stream {s.contractStreamId != null ? `#${s.contractStreamId}` : s.id.slice(-6)}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            s.status === 'ACTIVE'
                              ? 'bg-emerald-400/15 text-emerald-300'
                              : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {s.status === 'ACTIVE' ? 'Running' : 'Ended'}
                        </span>
                        {s.mode === 'demo' && (
                          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300">Simulated</span>
                        )}
                      </p>
                      <p className="num mt-1 text-sm text-slate-400">
                        {fmtUsdc(s.ratePerSecond * 3600, 4)} USDC/h · {fmtKg(streamed * kgPerUsdc)} kg CO₂
                      </p>
                    </div>
                    {s.status === 'ACTIVE' && (
                      <div className="flex gap-2">
                        <button className="btn-ghost" onClick={() => onSettle(s.id)} disabled={busy}>
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
                          Settle now
                        </button>
                        <button className="btn-ghost" onClick={() => onStop(s.id)} disabled={busy}>
                          <CircleStop size={16} />
                          Stop
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Deposit used">
                    <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="num mt-2 flex justify-between text-xs text-slate-400">
                    <span>
                      {fmtUsdc(streamed, 4)} of {fmtUsdc(s.deposit, 2)} USDC used
                    </span>
                    <span>{s.status === 'ACTIVE' ? `${fmtDuration(remaining)} of funding left` : 'Closed'}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {metrics && metrics.offsets.length > 0 && (
        <div className="glass p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Cloud size={18} aria-hidden /> Settlement history
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {metrics.offsets.slice(0, 6).map((o) => (
              <li key={o.id} className="num flex justify-between text-slate-300">
                <span>{new Date(o.timestamp).toLocaleString()}</span>
                <span>
                  {fmtUsdc(o.usdcAmount, 4)} USDC → {fmtKg(o.carbonKgSaved)} kg CO₂
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass p-5">
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <span className="text-emerald-300">{icon}</span>
        {label}
      </p>
      <p className="num mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
