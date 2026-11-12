#!/usr/bin/env bash
# G5: the full paid loop with the spot leg on Base Sepolia, judged by a LOCKED judge contract.
#
#   scripts/testnet/g5.sh accounts          base.<root>: the second judge's account
#   scripts/testnet/g5.sh deploy-leg        KeelLeg v4 on HyperEVM, controlled only by base.<root>'s derived key
#   scripts/testnet/g5.sh fund <usdc>       relayer -> KeelLeg v4 perp margin
#   scripts/testnet/g5.sh deploy-judge      near_keel.wasm on base.<root>; spot leg = Base Sepolia. The token and
#                                           probe addresses are the relayer's first two CREATE addresses on Base,
#                                           fixed before they exist (the relayer has never sent a Base tx)
#   scripts/testnet/g5.sh lock              delete the judge's full-access key (irreversible), check zero keys
#   scripts/testnet/g5.sh deploy-base       TestWETH (nonce 0) + BalanceProbe (nonce 1) on Base Sepolia, then
#                                           mint 0.006 to the spot account; refuses if the addresses would differ
#   scripts/testnet/g5.sh evidence <tag>    Snapshot on HyperEVM + Balance on Base; waits for both finalities
#   scripts/testnet/g5.sh attest <tag>      agent: judge.attest for both logs (Read MPC: HyperEvm and Base)
#   scripts/testnet/g5.sh open|settle <tag> agent: judge.open_repair / judge.settle
#   scripts/testnet/g5.sh relay <job> <n>   relayer: the judge's signed order -> KeelLeg v4, watch the fill
#   scripts/testnet/g5.sh status
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

ROOT=${KEEL_NEAR_ACCOUNT:?run make keys}
JUDGE="base.$ROOT"
AGENT="agent.$ROOT"
MPC=v1.signer-prod.testnet
NEAR_RPC=https://test.rpc.fastnear.com
HYPER=https://rpc.hyperliquid-testnet.xyz/evm
BASE=https://sepolia.base.org
NEAR="$ROOT_DIR/node_modules/.bin/near"
WASM=contracts/near-keel/target/near/near_keel.wasm
JUDGE_BIN=./target/debug/keel-judge
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)
OUT=docs/results/g5
mkdir -p "$OUT"

key() { echo ".secrets/near/$1.json"; }
setenv() { grep -q "^$1=" .env && sed -i '' "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; export "$1=$2"; }
sleep_s() { python3 -I -c "import time,sys;time.sleep(float(sys.argv[1]))" "$1"; }

near_rpc() { curl -s "$NEAR_RPC" -H 'content-type: application/json' -d "$1"; }
near_view() {
  near_rpc "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$1" "$2" "$3")" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);res=(r.get("result") or {}).get("result")
if res is None: sys.exit("view failed: "+json.dumps(r)[:300])
print(bytes(res).decode())'
}
balance() {
  near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print(r["amount"] if r else "")'
}
access_keys() {
  near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;print(len(json.load(sys.stdin)["result"]["keys"]))'
}
call() { # <signer> <method> <json> <deposit> <log>
  "$NEAR" contract call-function as-transaction "$JUDGE" "$2" json-args "$3" prepaid-gas '200.0 Tgas' attached-deposit "$4" \
    sign-as "$1" network-config testnet sign-with-access-key-file "$(key "$1")" send > "$5" 2>&1 || true
  sed 's/\x1b\[[0-9;]*m//g' "$5" | grep -E "Transaction ID|Smart contract panicked|succeeded|failed|Error" | head -4
}
derive() {
  local k
  k=$(near_view "$MPC" derived_public_key "{\"path\":\"$1\",\"predecessor\":\"$JUDGE\",\"domain_id\":0}" | tr -d '"')
  $JUDGE_BIN evm-address "$k" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}
finalized() { # <rpc> <tx>
  local bn
  bn=$(cast receipt "$2" blockNumber --rpc-url "$1")
  until [ "$(cast block finalized --field number --rpc-url "$1")" -ge "$bn" ]; do sleep_s 10; done
}
receipt_log() { # <rpc> <tx> <emitter>
  cast receipt "$2" --rpc-url "$1" --json |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(json.dumps([l for l in r["logs"] if l["address"].lower()==sys.argv[1].lower()][-1]))' "$3"
}
evidence_key() { # <chain> <log.json>
  python3 -I -c 'import json,sys;l=json.load(open(sys.argv[2]));print("%s:%s:%d"%(sys.argv[1],l["transactionHash"].lower(),int(l["logIndex"],16)))' "$1" "$2"
}
send_tx() { # <rpc> <to> <sig> args... -> tx hash
  local rpc=$1; shift
  cast send "$@" --rpc-url "$rpc" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])'
}

case "${1:-}" in
  accounts)
    [ -f "$(key "$JUDGE")" ] || node scripts/keys/gen_near_key.mjs "$JUDGE" "$(key "$JUDGE")" >/dev/null
    if [ -z "$(balance "$JUDGE")" ]; then
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$JUDGE")")
      "$NEAR" account create-account fund-myself "$JUDGE" "3.85 NEAR" use-manually-provided-public-key "$pk" \
        sign-as "$ROOT" network-config testnet sign-with-access-key-file "$(key "$ROOT")" send > "$OUT/create-judge.txt" 2>&1
    fi
    echo "$JUDGE: $(python3 -I -c "print('%.3f NEAR'%(int('$(balance "$JUDGE")' or 0)/1e24))")"
    ;;
  deploy-leg)
    ctrl=$(derive "keel/1/hyperevm"); spot=$(derive "keel/1/spot")
    leg=$(cd contracts/evm && forge create src/KeelLeg.sol:KeelLeg --rpc-url "$HYPER" --keystore ../../.secrets/evm/relayer \
      --password-file ../../.secrets/evm/relayer.password --broadcast --constructor-args "$ctrl" "$KEEL_PAYOUT" 4 4 1000000 100 500 | awk '/Deployed to/{print $3}')
    setenv G5_CONTROLLER "$ctrl"; setenv G5_SPOT "$spot"; setenv G5_LEG "$leg"
    printf 'controller=%s\nspot=%s\nleg=%s\n' "$ctrl" "$spot" "$leg" | tee "$OUT/leg.txt"
    ;;
  fund)
    .tools/venv/bin/python scripts/testnet/relayer.py to-perp "${2:?usdc}" >/dev/null
    .tools/venv/bin/python scripts/testnet/relayer.py send-perp-usdc "$G5_LEG" "$2" >/dev/null
    .tools/venv/bin/python scripts/testnet/relayer.py balances "$G5_LEG"
    ;;
  deploy-judge)
    [ "$(cast nonce "$KEEL_RELAYER_ADDRESS" --rpc-url "$BASE")" = 0 ] || { echo "relayer already used on Base: addresses are not predictable" >&2; exit 1; }
    token=$(cast compute-address "$KEEL_RELAYER_ADDRESS" --nonce 0 | awk '{print $NF}')
    probe=$(cast compute-address "$KEEL_RELAYER_ADDRESS" --nonce 1 | awk '{print $NF}')
    setenv G5_TOKEN "$token"; setenv G5_PROBE "$probe"
    cfg=$(python3 -I -c '
import json,os
print(json.dumps({"strategy_id":2,"chain_id":998,"leg":os.environ["G5_LEG"],"spot_account":os.environ["G5_SPOT"],
 "spot_token":os.environ["G5_TOKEN"],"probe":os.environ["G5_PROBE"],"spot_chain":"base",
 "policy":{"perp":4,"sz_decimals":4,"band_bp":100,"max_basis_bp":500,"fee_bp":5,"max_order_sz":1000000,
  "tolerance":100000,"max_loss_usd6":2000000,"settle_delay_l1":300,"max_evidence_age_s":3600,"order_ttl_s":300,
  "job_ttl_s":14400,"max_failed_attempts":3,"dust":10000,
  "repair_reward":"500000000000000000000000","flatten_reward":"500000000000000000000000"}}))')
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"owner":sys.argv[1],"mpc":sys.argv[2],"sign_path":"keel/1/hyperevm","sign_domain":0,"foreign_tx_domain":3,"config":json.loads(sys.argv[3])}))' "$ROOT" "$MPC" "$cfg")
    echo "$args" > "$OUT/init-args.json"
    "$NEAR" contract deploy "$JUDGE" use-file "$WASM" with-init-call new json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit '0.6 NEAR' \
      network-config testnet sign-with-access-key-file "$(key "$JUDGE")" send > "$OUT/deploy-judge.txt" 2>&1
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/deploy-judge.txt" | grep -E "Transaction ID|successfully|Error|panicked" | head -3
    echo "Base token (nonce 0) $token | probe (nonce 1) $probe"
    ;;
  lock)
    pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$JUDGE")")
    "$NEAR" account delete-keys "$JUDGE" public-keys "$pk" network-config testnet \
      sign-with-access-key-file "$(key "$JUDGE")" send > "$OUT/lock.txt" 2>&1
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/lock.txt" | grep -E "Transaction ID|Error" | head -2
    echo "access keys on $JUDGE: $(access_keys "$JUDGE")"
    ;;
  deploy-base)
    [ "$(cast nonce "$KEEL_RELAYER_ADDRESS" --rpc-url "$BASE")" = 0 ] || { echo "relayer nonce on Base is not 0" >&2; exit 1; }
    [ "$(cast balance "$KEEL_RELAYER_ADDRESS" --rpc-url "$BASE")" != 0 ] || { echo "relayer has no Base Sepolia ETH" >&2; exit 1; }
    cd contracts/evm
    token=$(forge create src/testnet/TestWETH.sol:TestWETH --rpc-url "$BASE" --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast | awk '/Deployed to/{print $3}')
    probe=$(forge create src/BalanceProbe.sol:BalanceProbe --rpc-url "$BASE" --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast | awk '/Deployed to/{print $3}')
    cd "$ROOT_DIR"
    lc() { echo "$1" | tr '[:upper:]' '[:lower:]'; }
    [ "$(lc "$token")" = "$(lc "$G5_TOKEN")" ] && [ "$(lc "$probe")" = "$(lc "$G5_PROBE")" ] || { echo "deployed $token $probe, expected $G5_TOKEN $G5_PROBE" >&2; exit 1; }
    send_tx "$BASE" "$token" "mint(address,uint256)" "$G5_SPOT" 6000000000000000 > "$OUT/mint-tx.txt"
    printf 'token=%s\nprobe=%s\nmint=%s\n' "$token" "$probe" "$(cat "$OUT/mint-tx.txt")" | tee "$OUT/base.txt"
    ;;
  evidence)
    tag=${2:?tag}; b32=$(cast format-bytes32-string "$tag")
    # Base first: it takes ~20 min to finalize. The perp snapshot is taken only afterwards, so the
    # judge plans on a current price (a 20-minute-old mark made KeelLeg refuse the order as stale).
    tx2=$(send_tx "$BASE" "$G5_PROBE" "probe(address,address,bytes32)" "$G5_SPOT" "$G5_TOKEN" "$b32")
    echo "probe $tx2 (Base); waiting for finality (~20 min)"
    finalized "$BASE" "$tx2"
    tx1=$(send_tx "$HYPER" "$G5_LEG" "snapshot(bytes32)" "$b32")
    finalized "$HYPER" "$tx1"
    echo "snapshot $tx1 (HyperEVM)"
    receipt_log "$HYPER" "$tx1" "$G5_LEG" > "$OUT/$tag-perp-log.json"
    receipt_log "$BASE" "$tx2" "$G5_PROBE" > "$OUT/$tag-spot-log.json"
    echo "perp $(evidence_key hyperevm "$OUT/$tag-perp-log.json")"
    echo "spot $(evidence_key base "$OUT/$tag-spot-log.json")"
    ;;
  attest)
    tag=${2:?tag}
    for pair in "perp:hyperevm" "spot:base"; do
      leg=${pair%%:*}; chain=${pair##*:}
      args=$(python3 -I -c 'import json,sys;print(json.dumps({"chain":sys.argv[2],"log":json.load(open(sys.argv[1]))}))' "$OUT/$tag-$leg-log.json" "$chain")
      echo "attest $leg ($chain):"; call "$AGENT" attest "$args" '1 yoctoNEAR' "$OUT/$tag-$leg-attest.txt"
      near_view "$JUDGE" get_attested "{\"key\":\"$(evidence_key "$chain" "$OUT/$tag-$leg-log.json")\"}" | python3 -I -c 'import json,sys;v=json.load(sys.stdin);print("  stored:", "yes" if v else "NO")'
    done
    ;;
  open|settle)
    tag=${2:?tag}; method=$([ "$1" = open ] && echo open_repair || echo settle)
    args="{\"perp\":\"$(evidence_key hyperevm "$OUT/$tag-perp-log.json")\",\"spot\":\"$(evidence_key base "$OUT/$tag-spot-log.json")\"}"
    call "$AGENT" "$method" "$args" '0 NEAR' "$OUT/$tag-$1.txt"
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/$tag-$1.txt" | grep -oE '\{"outcome".*\}' | head -1
    ;;
  relay)
    job=${2:?job}; nonce=${3:?nonce}
    sig=$(near_view "$JUDGE" get_signature "{\"job_id\":$job,\"nonce\":$nonce}")
    echo "$sig" > "$OUT/sig-$job-$nonce.json"
    [ "$sig" != "null" ] || { echo "no signature yet for $job:$nonce" >&2; exit 1; }
    tuple=$(python3 -I -c 'import json,sys;o=json.loads(sys.argv[1])["order"];print("(%s,%s,%s,%s,%s,%s,%s)"%(o["nonce"],str(o["is_buy"]).lower(),o["limit_px"],o["sz"],str(o["reduce_only"]).lower(),o["cloid"],o["deadline"]))' "$sig")
    eval "$(python3 -I -c 'import json,sys;d=json.loads(sys.argv[1]);print("v=%s r=%s s=%s"%(d["v"],d["r"],d["s"]))' "$sig")"
    before=$(cast call "$G5_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G5_LEG" --rpc-url "$HYPER" | head -1)
    echo "relayed $(send_tx "$HYPER" "$G5_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" "$tuple" "$v" "$r" "$s")"
    python3 -I scripts/testnet/watch.py "$G5_LEG" "$before" 60 | tee "$OUT/fill-$job-$nonce.json"
    ;;
  status)
    near_view "$JUDGE" get_strategy '{}' | python3 -I -c '
import json,sys
s=json.load(sys.stdin); j=s.get("job")
print("mode", s["mode"], "| nonce", s["nonce"], "| pool", int(s["pool"])/1e24, "NEAR | payouts", s["payouts"])
if j: print("job", j["id"], j["kind"], "agent", j["agent"], "| signed", j["signed"], "failed", j["failed"])'
    echo "judge $JUDGE access keys: $(access_keys "$JUDGE") | agent $AGENT: $(python3 -I -c "print('%.4f NEAR'%(int('$(balance "$AGENT")' or 0)/1e24))")"
    echo "relayer Base Sepolia: $(cast balance "$KEEL_RELAYER_ADDRESS" --rpc-url "$BASE" --ether) ETH, nonce $(cast nonce "$KEEL_RELAYER_ADDRESS" --rpc-url "$BASE")"
    echo "KeelLeg v4 $G5_LEG: position $(cast call "$G5_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G5_LEG" --rpc-url "$HYPER" | head -1)"
    ;;
  *)
    sed -n '2,19p' "$0"; exit 2 ;;
esac
