import {
  getAddress,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';

const msg = (e: unknown, fallback: string): string =>
  typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : fallback;

export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const r = await isConnected();
    return Boolean(r.isConnected);
  } catch {
    return false;
  }
}

export async function connectWallet(): Promise<string> {
  if (!(await isFreighterInstalled())) {
    throw new Error('Freighter not detected. Install the extension from freighter.app and reload.');
  }
  const r = await requestAccess();
  if (r.error) throw new Error(msg(r.error, 'Freighter access was denied'));
  return r.address;
}

export async function getConnectedAddress(): Promise<string | null> {
  try {
    const r = await getAddress();
    return r.error || !r.address ? null : r.address;
  } catch {
    return null;
  }
}

export async function signXdr(xdr: string, networkPassphrase: string, address: string): Promise<string> {
  const r = await signTransaction(xdr, { networkPassphrase, address });
  if (r.error) throw new Error(msg(r.error, 'Signing was rejected in Freighter'));
  return r.signedTxXdr;
}
