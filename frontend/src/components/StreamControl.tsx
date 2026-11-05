import { useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { fmtDuration, fmtKg, fmtUsdc, hourlyToPerSecond } from '../lib/format';

interface Props {
  address: string | null;
  kgPerUsdc: number;
  disabled?: boolean;
  onStart: (input: { ratePerSecond: number; deposit: number }) => Promise<void>;
}

export default function StreamControl({ address, kgPerUsdc, disabled, onStart }: Props) {
  const [perHour, setPerHour] = useState('0.36');
  const [deposit, setDeposit] = useState('10');
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const h = Number(perHour);
    const d = Number(deposit);
    const rate = hourlyToPerSecond(h);
    const valid = h > 0 && d > 0 && rate > 0 && d >= rate;
    return {
      valid,
      rate,
      runtime: valid ? d / rate : 0,
      kgPerHour: h * kgPerUsdc,
      kgTotal: d * kgPerUsdc,
    };
  }, [perHour, deposit, kgPerUsdc]);

  async function submit() {
    if (!preview.valid || busy) return;
    setBusy(true);
    try {
      await onStart({ ratePerSecond: preview.rate, deposit: Number(deposit) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass p-5 sm:p-6">
      <h2 className="text-lg font-bold">Start a stream</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your deposit is locked in the vault. Only what has streamed is paid out; stop anytime to get the rest back.
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Rate (USDC per hour)</span>
          <input
            className="field num"
            inputMode="decimal"
            value={perHour}
            onChange={(e) => setPerHour(e.target.value)}
            aria-describedby="rate-hint"
          />
          <span id="rate-hint" className="num mt-1.5 block text-xs text-slate-500">
            {preview.rate > 0 ? `${preview.rate.toFixed(7)} USDC every second` : 'Enter a rate above zero'}
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-300">Deposit (USDC)</span>
          <input className="field num" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </label>
      </div>

      <dl className="num mt-5 space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-400">Funded for</dt>
          <dd>{preview.valid ? fmtDuration(preview.runtime) : '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Offset per hour</dt>
          <dd>{preview.valid ? `${fmtKg(preview.kgPerHour)} kg` : '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Offset if fully used</dt>
          <dd>{preview.valid ? `${fmtKg(preview.kgTotal)} kg for ${fmtUsdc(Number(deposit), 2)} USDC` : '—'}</dd>
        </div>
      </dl>

      <button className="btn-primary mt-5 w-full" onClick={submit} disabled={!address || !preview.valid || busy || disabled}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
        {busy ? 'Starting stream…' : 'Start stream'}
      </button>
      {!address && <p className="mt-2 text-center text-xs text-slate-500">Connect your wallet to start streaming.</p>}
    </div>
  );
}
