import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from './config';

export const networkPassphrase = config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith('http://') });

export const addressArg = (a: string): xdr.ScVal => new Address(a).toScVal();
export const i128Arg = (v: bigint): xdr.ScVal => nativeToScVal(v, { type: 'i128' });
export const u64Arg = (v: number): xdr.ScVal => nativeToScVal(BigInt(v), { type: 'u64' });

/** Builds and simulates a contract invocation, returning an unsigned, prepared XDR. */
export async function buildInvokeXdr(
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(config.contractId).call(method, ...args))
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

/** Guards against submitting transactions that were built for a different account. */
export function assertSource(signedXdr: string, expected: string): void {
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const source = 'innerTransaction' in tx ? tx.innerTransaction.source : (tx as Transaction).source;
  if (source !== expected) throw new Error('Signed transaction source does not match stream owner');
}

export interface SubmitResult {
  hash: string;
  returnValue: unknown;
}

export async function submitSignedXdr(signedXdr: string): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error(`Soroban RPC rejected the transaction: ${sent.errorResult?.toXDR('base64') ?? 'unknown error'}`);
  }
  for (let i = 0; i < 40; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, returnValue: res.returnValue ? scValToNative(res.returnValue) : null };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${sent.hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for transaction ${sent.hash}`);
}

/** Signs with the oracle key and submits (used for withdraw_stream settlements). */
export async function invokeAsOracle(method: string, args: xdr.ScVal[]): Promise<SubmitResult> {
  const kp = Keypair.fromSecret(config.oracleSecret);
  const unsigned = await buildInvokeXdr(kp.publicKey(), method, args);
  const tx = TransactionBuilder.fromXDR(unsigned, networkPassphrase);
  tx.sign(kp);
  return submitSignedXdr(tx.toXDR());
}
