#!/usr/bin/env bash
# Testnet-only keys for Keel-0, generated into .secrets/ (git-ignored). Prints addresses, never keys.
#   - a NEAR testnet account, created free through the NEAR faucet service
#   - an EVM relayer key (encrypted keystore + password file) that pays HyperEVM gas
# Writes the public values to .env. Safe to re-run: existing keys are kept.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
umask 077
mkdir -p .secrets/near .secrets/evm
NEAR="$ROOT/node_modules/.bin/near"
[ -x "$NEAR" ] || npm install --silent
set -a; [ -f .env ] && source .env; set +a

view_account() {
  curl -s https://rpc.testnet.near.org -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print(r["amount"] if r else "")'
}

# ---- NEAR ----
if [ -z "${KEEL_NEAR_ACCOUNT:-}" ]; then
  KEEL_NEAR_ACCOUNT="keel-$(openssl rand -hex 3).testnet"
fi
KEY=".secrets/near/$KEEL_NEAR_ACCOUNT.json"
[ -f "$KEY" ] || node scripts/keys/gen_near_key.mjs "$KEEL_NEAR_ACCOUNT" "$KEY" >/dev/null
if [ -z "$(view_account "$KEEL_NEAR_ACCOUNT")" ]; then
  PK=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$KEY")
  "$NEAR" account create-account sponsor-by-faucet-service "$KEEL_NEAR_ACCOUNT" \
    use-manually-provided-public-key "$PK" network-config testnet create >/dev/null
  for _ in $(seq 1 20); do [ -n "$(view_account "$KEEL_NEAR_ACCOUNT")" ] && break; sleep 2; done
fi
[ -n "$(view_account "$KEEL_NEAR_ACCOUNT")" ] || { echo "NEAR account $KEEL_NEAR_ACCOUNT was not created" >&2; exit 1; }

# ---- EVM relayer ----
if [ ! -f .secrets/evm/relayer ]; then
  openssl rand -hex 32 > .secrets/evm/relayer.password
  CAST_PASSWORD="$(cat .secrets/evm/relayer.password)" cast wallet new .secrets/evm relayer >/dev/null
fi
KEEL_RELAYER_ADDRESS=$(cast wallet address --keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)

# ---- public values ----
cat > .env <<ENV
KEEL_NEAR_ACCOUNT=$KEEL_NEAR_ACCOUNT
KEEL_RELAYER_ADDRESS=$KEEL_RELAYER_ADDRESS
KEEL_PAYOUT=${KEEL_PAYOUT:-$KEEL_RELAYER_ADDRESS}
KEEL_LEG=${KEEL_LEG:-}
ENV

echo "NEAR testnet account:  $KEEL_NEAR_ACCOUNT  ($(python3 -I -c "print(f'{int(\"$(view_account "$KEEL_NEAR_ACCOUNT")\")/1e24:.2f}')") NEAR)"
echo "EVM relayer address:   $KEEL_RELAYER_ADDRESS"
echo "Fund the relayer with Hyperliquid testnet USDC (see docs/testnet-runbook.md)."
