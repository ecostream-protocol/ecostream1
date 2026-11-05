#!/usr/bin/env bash
# Builds, deploys and initializes the EcoStream contract on Stellar testnet.
# Requires: stellar CLI (https://developers.stellar.org/docs/tools/cli), rustup target wasm32-unknown-unknown
# Usage: ADMIN=alice ORACLE_ADDR=G... ISSUER_ADDR=G... USDC_ADDR=C... ./scripts/deploy.sh
set -euo pipefail

: "${ADMIN:?Set ADMIN to a stellar CLI identity name (stellar keys generate alice --network testnet --fund)}"
: "${ORACLE_ADDR:?Set ORACLE_ADDR to the oracle/gateway public key (G...)}"
: "${ISSUER_ADDR:?Set ISSUER_ADDR to the green credit issuer public key (G...)}"
: "${USDC_ADDR:?Set USDC_ADDR to the USDC Stellar Asset Contract id (C...)}"
NETWORK="${NETWORK:-testnet}"
GRAMS_PER_USDC="${GRAMS_PER_USDC:-25000}"

cd "$(dirname "$0")/../contracts"
stellar contract build
WASM=target/wasm32-unknown-unknown/release/ecostream.wasm

CONTRACT_ID=$(stellar contract deploy --wasm "$WASM" --source "$ADMIN" --network "$NETWORK")
ADMIN_ADDR=$(stellar keys address "$ADMIN")

stellar contract invoke --id "$CONTRACT_ID" --source "$ADMIN" --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDR" --asset "$USDC_ADDR" --oracle "$ORACLE_ADDR" \
  --issuer "$ISSUER_ADDR" --grams_per_usdc "$GRAMS_PER_USDC"

echo
echo "Deployed. Put this in backend/.env:"
echo "CONTRACT_ID=$CONTRACT_ID"
