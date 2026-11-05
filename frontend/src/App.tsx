import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import StreamControl from './components/StreamControl';
import { api, type Health, type Metrics } from './services/api';
import { connectWallet, getConnectedAddress, signXdr } from './services/wallet';

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => performance.now());
  const [now, setNow] = useState(() => performance.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addressRef = useRef<string | null>(null);
  addressRef.current = address;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong');

  const refresh = useCallback(async () => {
    const a = addressRef.current;
    if (!a) return;
    try {
      const m = await api.getMetrics(a);
      setMetrics(m);
      setFetchedAt(performance.now());
    } catch (e) {
      fail(e);
    }
  }, []);

  // Boot: backend health + previously authorised wallet.
  useEffect(() => {
    api.health().then(setHealth).catch(() => setError('Cannot reach the EcoStream API. Is the backend running on port 4000?'));
    getConnectedAddress().then((a) => a && setAddress(a));
  }, []);

  // Fetch metrics when the wallet changes, then poll.
  useEffect(() => {
    if (!address) {
      setMetrics(null);
      return;
    }
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [address, refresh]);

  // Smooth live counters.
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      setAddress(await connectWallet());
    } catch (e) {
      fail(e);
    } finally {
      setConnecting(false);
    }
  }

  async function handleStart(input: { ratePerSecond: number; deposit: number }) {
    if (!address) return;
    setError(null);
    try {
      const { stream, xdr } = await api.startStream({ userAddress: address, ...input });
      if (xdr && health) {
        const signed = await signXdr(xdr, health.networkPassphrase, address);
        await api.confirmStream(stream.id, signed);
      }
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function handleSettle(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.settleStream(id);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(id: string) {
    if (!address) return;
    setBusyId(id);
    setError(null);
    try {
      const first = await api.stopStream(id);
      if (first.xdr && health) {
        const signed = await signXdr(first.xdr, health.networkPassphrase, address);
        await api.stopStream(id, signed);
      }
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar
        address={address}
        connecting={connecting}
        health={health}
        onConnect={handleConnect}
        onDisconnect={() => setAddress(null)}
      />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {error && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}

        {!address && (
          <div className="glass mb-6 p-6 sm:p-8">
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Pay for carbon credits one second at a time.
            </h1>
            <p className="mt-3 max-w-xl text-slate-400">
              Connect a Stellar wallet, choose a USDC rate, and EcoStream settles it to a green credit issuer in real
              time while retiring matching credits.
            </p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Dashboard
            metrics={metrics}
            fetchedAt={fetchedAt}
            now={now}
            kgPerUsdc={health?.kgPerUsdc ?? 25}
            busyId={busyId}
            onSettle={handleSettle}
            onStop={handleStop}
          />
          <div className="lg:sticky lg:top-24 lg:self-start">
            <StreamControl address={address} kgPerUsdc={health?.kgPerUsdc ?? 25} onStart={handleStart} />
          </div>
        </div>
      </main>
    </div>
  );
}
