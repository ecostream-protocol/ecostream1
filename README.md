[README.md](https://github.com/user-attachments/files/34451839/README.md)
# ecostream1# EcoStream

Stream USDC per second to a green credit issuer on Stellar Soroban, retiring tokenized carbon credits as value settles. Includes a Soroban contract, an Express + Prisma backend and a React dashboard with Freighter wallet support.

```
ecostream/
├── contracts/   Soroban contract (Rust) with unit tests
├── backend/     Express + Prisma (SQLite) + @stellar/stellar-sdk
├── frontend/    React + Vite + Tailwind + Freighter
└── scripts/     deploy.sh (testnet deploy + initialize)
```

## Quick start (demo mode, no blockchain needed)

Demo mode is on whenever `CONTRACT_ID` or `ORACLE_SECRET` is empty. Streams are simulated locally so you can use the whole UI immediately. A Freighter wallet is still required to provide an address.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # already provided as .env
npx prisma db push
npm run dev                 # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

## Contract

```bash
cd contracts
cargo test                                   # unit tests
rustup target add wasm32-unknown-unknown
stellar contract build                       # or: cargo build --target wasm32-unknown-unknown --release
```

| Function | Auth | What it does |
|---|---|---|
| `initialize(admin, asset, oracle, issuer, grams_per_usdc)` | admin | One-time setup |
| `start_stream(owner, rate, deposit)` | owner | Locks the deposit, records the per-second rate (stroops) |
| `top_up(id, amount)` | owner | Settles accrued value, then adds funds |
| `withdraw_stream(id)` | oracle | Pays accrued USDC to the issuer and locks matching credits |
| `close_stream(id)` | owner | Settles, refunds the unspent balance, closes the stream |
| `get_stream`, `pending_amount`, `get_config`, `total_credits_grams` | none | Views |

Accrual is `rate × elapsed ledger seconds`, capped at the remaining deposit. Credits are tracked in grams of CO₂e: `grams = amount × grams_per_usdc / 10^7`.

## Going on-chain (testnet)

1. Install the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) and create identities:
   ```bash
   stellar keys generate admin --network testnet --fund
   stellar keys generate oracle --network testnet --fund
   stellar keys generate issuer --network testnet --fund
   ```
2. Get the testnet USDC Stellar Asset Contract id (for a test asset, `stellar contract asset deploy --asset USDC:<ISSUER_G> --source admin --network testnet`). Add a USDC trustline to the user wallet and the issuer account.
3. Deploy and initialize:
   ```bash
   ADMIN=admin ORACLE_ADDR=$(stellar keys address oracle) ISSUER_ADDR=$(stellar keys address issuer) \
   USDC_ADDR=C... ./scripts/deploy.sh
   ```
4. Edit `backend/.env`:
   ```
   CONTRACT_ID=C...            # printed by deploy.sh
   ORACLE_SECRET=S...          # stellar keys show oracle
   STELLAR_NETWORK=testnet
   AUTO_SETTLE_MS=60000        # optional: oracle settles every minute
   ```
5. Restart the backend. The navbar badge changes from "Demo mode" to "Stellar testnet".

### Transaction flow

1. The frontend calls `POST /api/streams/start`. The backend records a `PENDING` stream, simulates `start_stream` and returns an unsigned XDR.
2. Freighter signs the XDR in the browser. The frontend calls `POST /api/streams/:id/confirm`, and the backend submits it and marks the stream `ACTIVE`.
3. The oracle key (server side) calls `withdraw_stream` on `POST /api/streams/:id/settle` or on the auto-settle timer.
4. Stopping returns an unsigned `close_stream` XDR; after signing, the backend submits it and records the refund.

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/health` | | mode, network, passphrase, CO₂ factor |
| POST | `/api/streams/start` | `{ userAddress, ratePerSecond, deposit }` | Returns `{ stream, xdr }` (`xdr` is null in demo mode) |
| POST | `/api/streams/:id/confirm` | `{ signedXdr }` | Submits the signed start transaction |
| POST | `/api/streams/:id/settle` | | Oracle settlement |
| POST | `/api/streams/:id/stop` | `{ signedXdr? }` | Without `signedXdr` on-chain, returns the XDR to sign |
| GET | `/api/streams/:address` | | Summary, streams and settlement history |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4000 | API port |
| `DATABASE_URL` | `file:./dev.db` | SQLite file |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `STELLAR_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `SOROBAN_RPC_URL` | testnet RPC | Soroban RPC endpoint |
| `CONTRACT_ID`, `ORACLE_SECRET` | empty | Enable on-chain mode |
| `KG_CO2_PER_USDC` | 25 | Must equal `GRAMS_PER_USDC / 1000` used at initialization |
| `AUTO_SETTLE_MS` | 0 | Periodic oracle settlement |

## Tests

```bash
cd contracts && cargo test
cd backend && npm test
cd frontend && npm test
```

## Production notes

- Keep `ORACLE_SECRET` in a secrets manager and never expose it to the browser.
- For mainnet set `STELLAR_NETWORK=mainnet`, a mainnet RPC URL, and use real USDC (issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
- The conversion factor (25 kg CO₂ per USDC) is an illustrative default. Set it from your credit issuer's price per tonne.
- The backend has no user authentication. Wallet signatures protect on-chain actions, but add auth before exposing the settle endpoint publicly.
