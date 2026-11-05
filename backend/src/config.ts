import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  network: (process.env.STELLAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet',
  rpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  contractId: process.env.CONTRACT_ID ?? '',
  oracleSecret: process.env.ORACLE_SECRET ?? '',
  kgPerUsdc: Number(process.env.KG_CO2_PER_USDC ?? 25),
  autoSettleMs: Number(process.env.AUTO_SETTLE_MS ?? 0),
};

/** Without a deployed contract and oracle key the API simulates streams locally. */
export const demoMode = !config.contractId || !config.oracleSecret;
