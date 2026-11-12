#!/usr/bin/env bash
# Keel-0 on NEAR testnet + HyperEVM testnet (docs/testnet-runbook.md).
#
#   scripts/testnet/keel0.sh status                 balances and what is still missing (sends nothing)
#   scripts/testnet/keel0.sh deploy                 deploy KeelLeg (ETH perp 4, cap 0.01 ETH, band 1% of mark,
#                                                   basis cap 5%: testnet ETH's mark sits ~4% off its oracle)
#   scripts/testnet/keel0.sh snapshot <tag>         G1a: emit a Snapshot; build its Read MPC request
#   scripts/testnet/keel0.sh attest <request.json>  G1b: verify_foreign_transaction from KEEL_NEAR_ACCOUNT
#   scripts/testnet/keel0.sh order <is-buy> <sz>    G2/G3: plan an IOC at half the band, MPC-sign, relay
#   scripts/testnet/keel0.sh sweep <usd-ntl> <usdc-wei>  MPC-sign a sweep (perp -> spot -> the fixed payout)
#
# Keys come from .secrets/ (`make keys`), public values from .env. Results go to docs/results/keel0/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# .env fills in only what the caller has not set (KEEL_LEG=... scripts/testnet/keel0.sh ... wins).
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

MPC=v1.signer-prod.testnet
NEAR_RPC=https://rpc.testnet.near.org
RPC=https://rpc.hyperliquid-testnet.xyz/evm
API=https://api.hyperliquid-testnet.xyz/info
CHAIN_ID=998
KEEL_ID=${KEEL_ID:-1}
PATH_HYPEREVM="keel/$KEEL_ID/hyperevm"
SIGN_DOMAIN=0
FOREIGN_TX_DOMAIN=3
OUT=docs/results/keel0
JUDGE=./target/debug/keel-judge
NEAR="$ROOT/node_modules/.bin/near"
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)
mkdir -p "$OUT"
[ -x "$JUDGE" ] || cargo build -q -p keel-core

need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "set $v (run make keys first)" >&2; exit 2; }; done; }

near_rpc() { curl -s "$NEAR_RPC" -H 'content-type: application/json' -d "$1"; }

near_view() {
  near_rpc "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$MPC" "$1" "$2")" |
    python3 -I -c 'import json,sys;print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
}

# Change call on the MPC contract, signed with the account's key file; output saved to $4.
near_call() {
  "$NEAR" contract call-function as-transaction "$MPC" "$1" json-args "$2" \
    prepaid-gas "$3" attached-deposit '1 yoctoNEAR' \
    sign-as "$KEEL_NEAR_ACCOUNT" network-config testnet \
    sign-with-access-key-file ".secrets/near/$KEEL_NEAR_ACCOUNT.json" send 2>&1 | tee "$4"
}

info() { curl -s -X POST "$API" -H 'content-type: application/json' -d "$1"; }

controller() {
  local key
  key=$(near_view derived_public_key "{\"path\":\"$PATH_HYPEREVM\",\"predecessor\":\"$KEEL_NEAR_ACCOUNT\",\"domain_id\":$SIGN_DOMAIN}" | tr -d '"')
  $JUDGE evm-address "$key" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}

core_balances() { # <address>: HyperCore perp account value and spot balances
  local perp spot
  perp=$(info '{"type":"clearinghouseState","user":"'"$1"'"}')
  spot=$(info '{"type":"spotClearinghouseState","user":"'"$1"'"}')
  python3 -I - "$1" "$perp" "$spot" <<'PY'
import json, sys
perp, spot = json.loads(sys.argv[2]), json.loads(sys.argv[3])
bal = {b["coin"]: b["total"] for b in spot.get("balances", [])}
pos = [p["position"] for p in perp.get("assetPositions", []) if p["position"]["coin"] == "ETH"]
print(f"    perp USDC {perp['marginSummary']['accountValue']}, spot {bal or '{}'}, ETH position {pos[0]['szi'] if pos else 0}")
PY
}

case "${1:-}" in
  status)
    need KEEL_NEAR_ACCOUNT KEEL_RELAYER_ADDRESS
    near_bal=$(near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$KEEL_NEAR_ACCOUNT\"}}" |
      python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print("%.2f NEAR" % (int(r["amount"])/1e24) if r else "missing")')
    hype=$(cast balance "$KEEL_RELAYER_ADDRESS" --rpc-url "$RPC" --ether)
    echo "NEAR account   $KEEL_NEAR_ACCOUNT: $near_bal"
    echo "Controller     $(controller)  (MPC key for $PATH_HYPEREVM; holds nothing)"
    echo "Relayer        $KEEL_RELAYER_ADDRESS"
    echo "    HyperEVM gas: $hype HYPE"
    core_balances "$KEEL_RELAYER_ADDRESS"
    if [ -n "${KEEL_LEG:-}" ]; then
      echo "KeelLeg        $KEEL_LEG (code: $(cast codesize "$KEEL_LEG" --rpc-url "$RPC") bytes, nonce $(cast call "$KEEL_LEG" "nonce()(uint64)" --rpc-url "$RPC"))"
      core_balances "$KEEL_LEG"
    else
      echo "KeelLeg        not deployed"
    fi
    ;;
  deploy)
    need KEEL_NEAR_ACCOUNT KEEL_PAYOUT
    ctrl=$(controller)
    (cd contracts/evm && forge create src/KeelLeg.sol:KeelLeg --rpc-url "$RPC" \
      --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast \
      --constructor-args "$ctrl" "$KEEL_PAYOUT" 4 4 1000000 100 500) | tee "$OUT/deploy.txt"
    leg=$(grep -E "Deployed to:" "$OUT/deploy.txt" | awk '{print $3}')
    [ -n "$leg" ] || { echo "no address in deploy output" >&2; exit 1; }
    sed -i '' "s/^KEEL_LEG=.*/KEEL_LEG=$leg/" .env
    echo "$leg $(date -u +%FT%TZ) controller=$ctrl" >> "$OUT/deployments.txt"
    echo "KeelLeg $leg, controller $ctrl (written to .env)"
    ;;
  snapshot)
    need KEEL_LEG
    tag=$(cast format-bytes32-string "${2:?tag}")
    tx=$(cast send "$KEEL_LEG" "snapshot(bytes32)" "$tag" --rpc-url "$RPC" "${RELAYER[@]}" --json |
      python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
    bn=$(cast receipt "$tx" blockNumber --rpc-url "$RPC")
    until [ "$(cast block finalized --field number --rpc-url "$RPC")" -ge "$bn" ]; do sleep 1; done
    cast receipt "$tx" --rpc-url "$RPC" --json |
      python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(json.dumps([l for l in r["logs"] if l["address"].lower()==sys.argv[1].lower()][-1]))' "$KEEL_LEG" \
      > "$OUT/$2-log.json"
    $JUDGE readmpc-request hyperevm "$(cat "$OUT/$2-log.json")" "$FOREIGN_TX_DOMAIN" | python3 -I -m json.tool > "$OUT/$2-request.json"
    echo "snapshot $tx finalized; request in $OUT/$2-request.json"
    ;;
  attest)
    need KEEL_NEAR_ACCOUNT
    req=${2:?request.json}
    args=$(python3 -I -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))["args"]))' "$req")
    near_call verify_foreign_transaction "$args" '300 Tgas' "${req%-request.json}-attest.txt"
    echo "compare the response payload_hash with expected_payload_hash in $req"
    ;;
  order)
    need KEEL_NEAR_ACCOUNT KEEL_LEG
    is_buy=${2:?is-buy}; sz=${3:?sz-1e8}
    nonce=$(cast call "$KEEL_LEG" "nonce()(uint64)" --rpc-url "$RPC")
    mark=$(cast call "$KEEL_LEG" "mark1e8()(uint64)" --rpc-url "$RPC" | cut -d' ' -f1)
    deadline=$(( $(date +%s) + 120 ))
    cloid=$(( (RANDOM << 15) + RANDOM + 1 ))
    plan="$OUT/order-$(date +%s)-n$nonce.json"
    $JUDGE plan-order "$CHAIN_ID" "$KEEL_LEG" "$nonce" "$mark" "$is_buy" "$sz" 50 4 "$deadline" "$cloid" > "$plan"
    tuple=$(python3 -I -c 'import json,sys;o=json.load(open(sys.argv[1]))["order"];print("(%s,%s,%s,%s,%s,%s,%s)"%(o["nonce"],str(o["is_buy"]).lower(),o["limit_px"],o["sz"],str(o["reduce_only"]).lower(),o["cloid"],o["deadline"]))' "$plan")
    digest=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["digest"])' "$plan")
    onchain=$(cast call "$KEEL_LEG" "orderDigest((uint64,bool,uint64,uint64,bool,uint128,uint64))(bytes32)" "$tuple" --rpc-url "$RPC")
    [ "$digest" = "$onchain" ] || { echo "digest mismatch with on-chain KeelLeg" >&2; exit 1; }
    sign_args=$($JUDGE sign-args "$PATH_HYPEREVM" "$digest" "$SIGN_DOMAIN" | python3 -I -c 'import json,sys;print(json.dumps(json.load(sys.stdin)["args"]))')
    sigout="${plan%.json}-sign.txt"
    near_call sign "$sign_args" '50 Tgas' "$sigout" >/dev/null
    resp=$(python3 -I -c '
import json,sys
t=open(sys.argv[1]).read(); dec=json.JSONDecoder()
for i in [i for i,c in enumerate(t) if c=="{"]:
    try:
        d,_=dec.raw_decode(t[i:])
    except ValueError:
        continue
    if isinstance(d,dict) and "big_r" in d:
        print(json.dumps(d)); break' "$sigout")
    [ -n "$resp" ] || { echo "no signature found in $sigout" >&2; exit 1; }
    eval "$($JUDGE vrs "$resp" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);print("v=%s r=%s s=%s"%(d["v"],d["r"],d["s"]))')"
    cast send "$KEEL_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" "$tuple" "$v" "$r" "$s" \
      --rpc-url "$RPC" "${RELAYER[@]}" --json | tee "${plan%.json}-relay.json" |
      python3 -I -c 'import json,sys;print("relayed", json.load(sys.stdin)["transactionHash"])'
    ;;
  sweep)
    need KEEL_NEAR_ACCOUNT KEEL_LEG
    ntl=${2:?usd-ntl}; wei=${3:?usdc-wei}
    nonce=$(cast call "$KEEL_LEG" "nonce()(uint64)" --rpc-url "$RPC")
    deadline=$(( $(date +%s) + 120 ))
    digest=$(cast call "$KEEL_LEG" "sweepDigest(uint64,uint64,uint64,uint64)(bytes32)" "$nonce" "$ntl" "$wei" "$deadline" --rpc-url "$RPC")
    sigout="$OUT/sweep-$(date +%s)-n$nonce-sign.txt"
    sign_args=$($JUDGE sign-args "$PATH_HYPEREVM" "$digest" "$SIGN_DOMAIN" | python3 -I -c 'import json,sys;print(json.dumps(json.load(sys.stdin)["args"]))')
    near_call sign "$sign_args" '50 Tgas' "$sigout" >/dev/null
    resp=$(python3 -I -c '
import json,sys
t=open(sys.argv[1]).read(); dec=json.JSONDecoder()
for i in [i for i,c in enumerate(t) if c=="{"]:
    try:
        d,_=dec.raw_decode(t[i:])
    except ValueError:
        continue
    if isinstance(d,dict) and "big_r" in d:
        print(json.dumps(d)); break' "$sigout")
    [ -n "$resp" ] || { echo "no signature found in $sigout" >&2; exit 1; }
    eval "$($JUDGE vrs "$resp" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);print("v=%s r=%s s=%s"%(d["v"],d["r"],d["s"]))')"
    cast send "$KEEL_LEG" "sweep(uint64,uint64,uint64,uint64,uint8,bytes32,bytes32)" "$nonce" "$ntl" "$wei" "$deadline" "$v" "$r" "$s" \
      --rpc-url "$RPC" "${RELAYER[@]}" --json | tee "${sigout%-sign.txt}-relay.json" |
      python3 -I -c 'import json,sys;print("relayed", json.load(sys.stdin)["transactionHash"])'
    ;;
  *)
    sed -n '2,13p' "$0"; exit 2 ;;
esac
