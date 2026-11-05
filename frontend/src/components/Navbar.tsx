import { Leaf, LogOut, Wallet } from 'lucide-react';
import type { Health } from '../services/api';
import { truncateAddress } from '../lib/format';

interface Props {
  address: string | null;
  connecting: boolean;
  health: Health | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function Navbar({ address, connecting, health, onConnect, onDisconnect }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400 text-slate-950">
            <Leaf size={20} aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight">EcoStream</p>
            <p className="hidden text-xs text-slate-400 sm:block">Carbon credits, paid by the second</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {health && (
            <span
              className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-xs sm:inline-flex ${
                health.mode === 'chain'
                  ? 'border-emerald-400/30 text-emerald-300'
                  : 'border-amber-400/30 text-amber-300'
              }`}
              title={health.contractId ?? 'No contract configured. Streams are simulated locally.'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${health.mode === 'chain' ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              {health.mode === 'chain' ? `Stellar ${health.network}` : 'Demo mode'}
            </span>
          )}

          {address ? (
            <div className="flex items-center gap-2">
              <span className="glass flex items-center gap-2 px-3 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
                <span className="num">{truncateAddress(address)}</span>
              </span>
              <button className="btn-ghost !px-3" onClick={onDisconnect} aria-label="Disconnect wallet">
                <LogOut size={16} aria-hidden />
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={onConnect} disabled={connecting}>
              <Wallet size={16} aria-hidden />
              {connecting ? 'Connecting…' : 'Connect Freighter'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
