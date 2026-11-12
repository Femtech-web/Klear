#!/usr/bin/env bash
# The practice strategy: a real Keel strategy on testnet, created through the factory, that fails on purpose
# every day so anyone can rescue it (agents/drill.py runs the cycle). Its manager goes silent, the investor's
# mandate says a silent manager means exit, and the first guardian to act is paid by the judge.
#
# Its payout addresses are the operator's relayer, so each cycle's funds return and fund the next one.
# Chain I/O for the running strategy is scripts/testnet/g7.sh with KEEL_DIR=docs/results/practice.
#
#   scripts/testnet/practice.sh accounts      keel-practice-<hex>.testnet (faucet) with investor., manager.
#                                             and guardian. sub-accounts, and the manager's function-call key
#                                             (propose_order and heartbeat on the practice judge only)
#   scripts/testnet/practice.sh create [pool] the judge through the factory (pool default 1 NEAR), then the
#                                             KeelLeg and KeelVault at their predicted addresses
#   scripts/testnet/practice.sh fund <usdc> <weth-wei>   top both legs up from the relayer
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

OUT=docs/results/practice
mkdir -p "$OUT"
STATE=$OUT/env
[ -f "$STATE" ] && set -a && . "$STATE" && set +a
. docs/results/factory/env

NEAR_RPC=https://rpc.testnet.near.org
NEAR="$ROOT_DIR/node_modules/.bin/near"
RELAYER_EVM=0x1d9Db7f01d68CF06B3A2D2498af09a09f186615c
JUDGE=practice.$FACTORY

key() { echo ".secrets/near/$1.json"; }
pub() { python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$1")"; }
put() { touch "$STATE"; grep -q "^$1=" "$STATE" && sed -i '' "s|^$1=.*|$1=$2|" "$STATE" || echo "$1=$2" >> "$STATE"; export "$1=$2"; }
plain() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }
balance() {
  curl -s "$NEAR_RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print(r["amount"] if r else "")'
}

case "${1:-}" in
  accounts)
    [ -n "${PRACTICE:-}" ] || put PRACTICE "keel-practice-$(openssl rand -hex 3).testnet"
    for a in "$PRACTICE" {investor,manager,guardian}."$PRACTICE"; do
      [ -f "$(key "$a")" ] || node scripts/keys/gen_near_key.mjs "$a" "$(key "$a")" >/dev/null
    done
    if [ -z "$(balance "$PRACTICE")" ]; then
      "$NEAR" account create-account sponsor-by-faucet-service "$PRACTICE" use-manually-provided-public-key "$(pub "$PRACTICE")" network-config testnet create > "$OUT/create-parent.txt" 2>&1
      for _ in $(seq 1 30); do [ -n "$(balance "$PRACTICE")" ] && break; sleep 2; done
    fi
    for s in investor manager guardian; do
      a="$s.$PRACTICE"
      [ -n "$(balance "$a")" ] && continue
      "$NEAR" account create-account fund-myself "$a" '0.5 NEAR' use-manually-provided-public-key "$(pub "$a")" \
        sign-as "$PRACTICE" network-config testnet sign-with-access-key-file "$(key "$PRACTICE")" send > "$OUT/create-$s.txt" 2>&1
    done
    if [ ! -f "$(key "manager-fc.$PRACTICE")" ]; then
      node scripts/keys/gen_near_key.mjs "manager.$PRACTICE" "$(key "manager-fc.$PRACTICE")" >/dev/null
      "$NEAR" account add-key "manager.$PRACTICE" grant-function-call-access --allowance '0.25 NEAR' --contract-account-id "$JUDGE" \
        --function-names 'propose_order, heartbeat' use-manually-provided-public-key "$(pub "manager-fc.$PRACTICE")" \
        network-config testnet sign-with-access-key-file "$(key "manager.$PRACTICE")" send > "$OUT/manager-key.txt" 2>&1
      plain "$OUT/manager-key.txt" | grep -E "Transaction ID|Error" | head -2
    fi
    put G7_JUDGE "$JUDGE"; put G7_INVESTOR "$RELAYER_EVM"; put G7_INVESTOR_ACCOUNT "investor.$PRACTICE"
    put G7_MANAGER "manager.$PRACTICE"; put G7_MANAGER_KEY "manager-fc.$PRACTICE"; put G7_GUARDIAN "guardian.$PRACTICE"
    for a in "$PRACTICE" {investor,manager,guardian}."$PRACTICE"; do echo "$a: $(python3 -I -c "print(f'{int(\"$(balance "$a")\" or 0)/1e24:.3f} NEAR')")"; done
    ;;
  create)
    pool=${2:-1}
    out=$(CREATOR=$PRACTICE scripts/testnet/factory.sh create practice "$OUT/policy.json" "$RELAYER_EVM" "investor.$PRACTICE" "$pool" "manager.$PRACTICE")
    echo "$out"
    eval "$(cat docs/results/factory/practice/addresses.txt)"
    put G7_LEG "$leg"; put G7_VAULT "$vault"; put G7_CONTROLLER "$controller"; put G7_VAULT_CONTROLLER "$vault_controller"
    ;;
  fund)
    # Top both legs up to <usdc> and <weth-wei> from the relayer, reusing what the last rescue paid back.
    usdc=${2:?usdc}; wei=${3:?weth wei}
    py=.tools/venv/bin/python
    have=$($py -I scripts/testnet/relayer.py balances "$G7_LEG" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["perp_account_value"])')
    need=$(python3 -I -c "print(max(0, round(float('$usdc') - float('$have'), 2)))")
    if [ "$need" != 0 ]; then
      # A first transfer to a new HyperCore account also costs the sender 1 USDC.
      rel=$($py -I scripts/testnet/relayer.py balances | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["perp_withdrawable"])')
      move=$(python3 -I -c "print(max(0, round(float('$need') + 1 - float('$rel'), 2)))")
      [ "$move" = 0 ] || $py -I scripts/testnet/relayer.py to-perp "$move" >/dev/null
      $py -I scripts/testnet/relayer.py send-perp-usdc "$G7_LEG" "$need" | python3 -I -c 'import json,sys;r=json.load(sys.stdin);sys.exit(0 if r.get("status")=="ok" else "usd send: "+json.dumps(r))'
    fi
    weth() { cast call 0x4200000000000000000000000000000000000006 'balanceOf(address)(uint256)' "$1" --rpc-url https://sepolia.base.org | cut -d' ' -f1; }
    short=$(python3 -I -c "print(max(0, $wei - $(weth "$G7_VAULT")))")
    if [ "$short" != 0 ]; then
      wrap=$(python3 -I -c "print(max(0, $short - $(weth "$RELAYER_EVM")))")
      [ "$wrap" = 0 ] || cast send 0x4200000000000000000000000000000000000006 'deposit()' --value "$wrap" --rpc-url https://sepolia.base.org \
        --keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password >/dev/null
      cast send 0x4200000000000000000000000000000000000006 'transfer(address,uint256)' "$G7_VAULT" "$short" --rpc-url https://sepolia.base.org \
        --keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password >/dev/null
    fi
    echo "leg: $($py -I scripts/testnet/relayer.py balances "$G7_LEG" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["perp_account_value"])') USDC | vault: $(weth "$G7_VAULT") WETH wei"
    ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
