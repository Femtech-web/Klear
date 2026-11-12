#!/usr/bin/env bash
# G6: the mandate and the manager-proof exit, on a LOCKED judge.
#
# The investor's mandate: a manager (here a SCRIPTED stand-in for an AI agent) may only propose orders,
# signed only within size, price band and 1x leverage on attested state, and never below the investor's
# equity floor. Below the floor anyone (a guardian) may exit: close the perp on Hyperliquid, move the spot
# leg on Base to the investor, sweep the perp USDC to the investor. Nobody holds a key that could block it.
#
#   scripts/testnet/g6.sh accounts             faucet account for the judge + ai.<judge> (the manager)
#   scripts/testnet/g6.sh deploy-leg           KeelLeg v5 (controller: the judge's key; payout: the investor)
#   scripts/testnet/g6.sh fund <usdc>          relayer -> KeelLeg margin; tWETH + gas to the judge's Base account
#   scripts/testnet/g6.sh deploy-judge <floor-usd6>   judge with the mandate; 0.6 NEAR reward pool
#   scripts/testnet/g6.sh lock                 delete the judge's key (irreversible)
#   scripts/testnet/g6.sh spot <tag>           Balance on Base (waits ~20 min for finality) + attest
#   scripts/testnet/g6.sh ai <buy|sell> <sz>   the manager: snapshot + attest, then propose; relay if signed
#   scripts/testnet/g6.sh exit <tag>           guardian: snapshot + attest, open_flatten, relay perp order + Base tx
#   scripts/testnet/g6.sh relay-spot <n>       anyone: broadcast the judge-signed Base exit tx (spot nonce n)
#   scripts/testnet/g6.sh settle <tag>         guardian: snapshot + attest (needs a fresh `spot` tag), settle
#   scripts/testnet/g6.sh sweep                anyone after the exit: perp USDC to the investor
#   scripts/testnet/g6.sh status
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

INVESTOR=${G6_INVESTOR:-0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4}
AGENT="agent.${KEEL_NEAR_ACCOUNT:?run make keys}"
MPC=v1.signer-prod.testnet
NEAR_RPC=https://rpc.testnet.near.org
HYPER=https://rpc.hyperliquid-testnet.xyz/evm
BASE=https://sepolia.base.org
NEAR="$ROOT_DIR/node_modules/.bin/near"
WASM=contracts/near-keel/target/near/near_keel.wasm
JUDGE_BIN=./target/debug/keel-judge
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)
TOKEN=${G5_TOKEN:?}   # TestWETH on Base Sepolia (relayer is its minter)
PROBE=${G5_PROBE:?}   # BalanceProbe on Base Sepolia
OUT=docs/results/g6
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
  "$NEAR" contract call-function as-transaction "$G6_JUDGE" "$2" json-args "$3" prepaid-gas '250.0 Tgas' attached-deposit "$4" \
    sign-as "$1" network-config testnet sign-with-access-key-file "$(key "$1")" send > "$5" 2>&1 || true
  sed 's/\x1b\[[0-9;]*m//g' "$5" | grep -E "Transaction ID|Smart contract panicked|succeeded" | head -3
  sed 's/\x1b\[[0-9;]*m//g' "$5" | grep -oE '\{"outcome".*\}' | head -1 || true
}
derive() {
  local k
  k=$(near_view "$MPC" derived_public_key "{\"path\":\"$1\",\"predecessor\":\"$G6_JUDGE\",\"domain_id\":0}" | tr -d '"')
  $JUDGE_BIN evm-address "$k" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}
send_tx() { local rpc=$1; shift; cast send "$@" --rpc-url "$rpc" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])'; }
finalized() { local bn; bn=$(cast receipt "$2" blockNumber --rpc-url "$1"); until [ "$(cast block finalized --field number --rpc-url "$1")" -ge "$bn" ]; do sleep_s 10; done; }
receipt_log() { cast receipt "$2" --rpc-url "$1" --json | python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(json.dumps([l for l in r["logs"] if l["address"].lower()==sys.argv[1].lower()][-1]))' "$3"; }
evidence_key() { python3 -I -c 'import json,sys;l=json.load(open(sys.argv[2]));print("%s:%s:%d"%(sys.argv[1],l["transactionHash"].lower(),int(l["logIndex"],16)))' "$1" "$2"; }
attest() { # <chain> <log.json> <signer>
  local args; args=$(python3 -I -c 'import json,sys;print(json.dumps({"chain":sys.argv[2],"log":json.load(open(sys.argv[1]))}))' "$2" "$1")
  call "$3" attest "$args" '1 yoctoNEAR' "${2%.json}-attest.txt" >/dev/null
  near_view "$G6_JUDGE" get_attested "{\"key\":\"$(evidence_key "$1" "$2")\"}" | python3 -I -c 'import json,sys;v=json.load(sys.stdin);sys.exit(0 if v else "not attested")'
}
perp_evidence() { # <tag> <signer> -> attested perp key
  local tx; tx=$(send_tx "$HYPER" "$G6_LEG" "snapshot(bytes32)" "$(cast format-bytes32-string "$1")")
  finalized "$HYPER" "$tx"; receipt_log "$HYPER" "$tx" "$G6_LEG" > "$OUT/$1-perp-log.json"
  attest hyperevm "$OUT/$1-perp-log.json" "$2"
  evidence_key hyperevm "$OUT/$1-perp-log.json"
}
relay_order() { # <record-key>
  local rec tuple
  rec=$(near_view "$G6_JUDGE" get_record "{\"key\":\"$1\"}"); echo "$rec" > "$OUT/record-${1/:/-}.json"
  [ "$rec" != "null" ] || { echo "no signature for $1 yet" >&2; return 1; }
  tuple=$(python3 -I -c 'import json,sys;o=json.loads(sys.argv[1])["order"];print("(%s,%s,%s,%s,%s,%s,%s)"%(o["nonce"],str(o["is_buy"]).lower(),o["limit_px"],o["sz"],str(o["reduce_only"]).lower(),o["cloid"],o["deadline"]))' "$rec")
  eval "$(python3 -I -c 'import json,sys;d=json.loads(sys.argv[1]);print("v=%s r=%s s=%s"%(d["v"],d["r"],d["s"]))' "$rec")"
  local before; before=$(cast call "$G6_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G6_LEG" --rpc-url "$HYPER" | head -1)
  echo "relayed $(send_tx "$HYPER" "$G6_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" "$tuple" "$v" "$r" "$s")"
  python3 -I scripts/testnet/watch.py "$G6_LEG" "$before" 60
}
spot_key() { evidence_key base "$OUT/$(cat "$OUT/latest-spot")-spot-log.json"; }

case "${1:-}" in
  accounts)
    if [ -z "${G6_JUDGE:-}" ]; then
      setenv G6_JUDGE "keel-mandate-$(openssl rand -hex 3).testnet"
    fi
    for acct in "$G6_JUDGE" "ai.$G6_JUDGE"; do
      [ -f "$(key "$acct")" ] || node scripts/keys/gen_near_key.mjs "$acct" "$(key "$acct")" >/dev/null
    done
    if [ -z "$(balance "$G6_JUDGE")" ]; then
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$G6_JUDGE")")
      "$NEAR" account create-account sponsor-by-faucet-service "$G6_JUDGE" use-manually-provided-public-key "$pk" network-config testnet create > "$OUT/create-judge.txt" 2>&1
      for _ in $(seq 1 20); do [ -n "$(balance "$G6_JUDGE")" ] && break; sleep_s 2; done
    fi
    if [ -z "$(balance "ai.$G6_JUDGE")" ]; then
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "ai.$G6_JUDGE")")
      "$NEAR" account create-account fund-myself "ai.$G6_JUDGE" '0.5 NEAR' use-manually-provided-public-key "$pk" \
        sign-as "$G6_JUDGE" network-config testnet sign-with-access-key-file "$(key "$G6_JUDGE")" send > "$OUT/create-ai.txt" 2>&1
    fi
    for a in "$G6_JUDGE" "ai.$G6_JUDGE"; do echo "$a: $(python3 -I -c "print('%.3f NEAR'%(int('$(balance "$a")' or 0)/1e24))")"; done
    ;;
  deploy-leg)
    ctrl=$(derive "keel/1/hyperevm"); spot=$(derive "keel/1/spot")
    leg=$(cd contracts/evm && forge create src/KeelLeg.sol:KeelLeg --rpc-url "$HYPER" --keystore ../../.secrets/evm/relayer \
      --password-file ../../.secrets/evm/relayer.password --broadcast --constructor-args "$ctrl" "$INVESTOR" 4 4 1000000 100 500 | awk '/Deployed to/{print $3}')
    setenv G6_CONTROLLER "$ctrl"; setenv G6_SPOT "$spot"; setenv G6_LEG "$leg"
    printf 'controller=%s\nspot_account=%s\nleg=%s\npayout(investor)=%s\n' "$ctrl" "$spot" "$leg" "$INVESTOR" | tee "$OUT/leg.txt"
    ;;
  fund)
    .tools/venv/bin/python scripts/testnet/relayer.py to-perp "${2:?usdc}" >/dev/null
    .tools/venv/bin/python scripts/testnet/relayer.py send-perp-usdc "$G6_LEG" "$2" >/dev/null
    echo "mint tWETH: $(send_tx "$BASE" "$TOKEN" "mint(address,uint256)" "$G6_SPOT" 6000000000000000)"
    echo "Base gas:   $(cast send "$G6_SPOT" --value 0.001ether --rpc-url "$BASE" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')"
    .tools/venv/bin/python scripts/testnet/relayer.py balances "$G6_LEG"
    ;;
  deploy-judge)
    floor=${2:?equity floor, USD x 1e6}
    cfg=$(python3 -I -c '
import json,os,sys
print(json.dumps({"strategy_id":3,"chain_id":998,"leg":os.environ["G6_LEG"],"spot_account":os.environ["G6_SPOT"],
 "spot_token":os.environ["G5_TOKEN"],"probe":os.environ["G5_PROBE"],"spot_chain":"base","spot_chain_id":84532,
 "manager":"ai."+os.environ["G6_JUDGE"],"investor":sys.argv[2],
 "policy":{"perp":4,"sz_decimals":4,"band_bp":100,"max_basis_bp":500,"fee_bp":5,"max_order_sz":1000000,
  "tolerance":100000,"max_loss_usd6":2000000,"settle_delay_l1":300,"max_evidence_age_s":3600,"order_ttl_s":300,
  "job_ttl_s":14400,"max_failed_attempts":3,"dust":10000,
  "repair_reward":"500000000000000000000000","flatten_reward":"500000000000000000000000",
  "max_leverage_bp":10000,"equity_floor_usd6":int(sys.argv[1]),"hedge":False,
  "spot_gas":80000,"spot_max_fee_wei":50000000,"spot_priority_fee_wei":1000000}}))' "$floor" "$INVESTOR")
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"owner":sys.argv[1],"mpc":sys.argv[2],"sign_path":"keel/1/hyperevm","sign_domain":0,"foreign_tx_domain":3,"spot_path":"keel/1/spot","config":json.loads(sys.argv[3])}))' "$KEEL_NEAR_ACCOUNT" "$MPC" "$cfg")
    echo "$args" > "$OUT/init-args.json"
    "$NEAR" contract deploy "$G6_JUDGE" use-file "$WASM" with-init-call new json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit '0.6 NEAR' \
      network-config testnet sign-with-access-key-file "$(key "$G6_JUDGE")" send > "$OUT/deploy-judge.txt" 2>&1
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/deploy-judge.txt" | grep -E "Transaction ID|successfully|Error|panicked" | head -3
    shasum -a 256 "$WASM" | tee -a "$OUT/deploy-judge.txt"
    ;;
  lock)
    pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$G6_JUDGE")")
    "$NEAR" account delete-keys "$G6_JUDGE" public-keys "$pk" network-config testnet sign-with-access-key-file "$(key "$G6_JUDGE")" send > "$OUT/lock.txt" 2>&1
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/lock.txt" | grep -E "Transaction ID|Error" | head -2
    echo "access keys on $G6_JUDGE: $(access_keys "$G6_JUDGE")"
    ;;
  spot)
    tag=${2:?tag}
    tx=$(send_tx "$BASE" "$PROBE" "probe(address,address,bytes32)" "$G6_SPOT" "$TOKEN" "$(cast format-bytes32-string "$tag")")
    echo "probe $tx; waiting for Base finality (~20 min)"
    finalized "$BASE" "$tx"; receipt_log "$BASE" "$tx" "$PROBE" > "$OUT/$tag-spot-log.json"
    attest base "$OUT/$tag-spot-log.json" "$AGENT" && echo "$tag" > "$OUT/latest-spot" && echo "spot $(spot_key) attested"
    ;;
  ai)
    side=${2:?buy|sell}; sz=${3:?size 1e8}; tag="ai-$(date +%s)"
    perp=$(perp_evidence "$tag" "ai.$G6_JUDGE")
    mark=$(cast call "$G6_LEG" "mark1e8()(uint64)" --rpc-url "$HYPER" | cut -d' ' -f1)
    px=$(python3 -I -c "
m=$mark; buy='$side'=='buy'
p=m*(10000+50)//10000 if buy else m*(10000-50)//10000
step=10**(len(str(p))-5); p=(p//step+(0 if buy else 1))*step
print(p)")
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"perp":sys.argv[1],"spot":sys.argv[2],"is_buy":sys.argv[3]=="buy","sz":int(sys.argv[4]),"limit_px":int(sys.argv[5])}))' "$perp" "$(spot_key)" "$side" "$sz" "$px")
    echo "AI manager (scripted) proposes: $side $sz @ $px"
    out=$(call "ai.$G6_JUDGE" propose_order "$args" '0 NEAR' "$OUT/$tag-propose.txt"); echo "$out"
    if echo "$out" | grep -q '"outcome":"sign"'; then
      nonce=$(echo "$out" | grep -oE '"nonce":"?[0-9]+' | grep -oE '[0-9]+' | head -1)
      sleep_s 3; relay_order "0:$nonce"
    fi
    ;;
  exit)
    tag=${2:?tag}
    perp=$(perp_evidence "$tag" "$AGENT")
    out=$(call "$AGENT" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$(spot_key)\"}" '0 NEAR' "$OUT/$tag-exit.txt"); echo "$out"
    sleep_s 4
    job=$(echo "$out" | grep -oE '"job_id":"?[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
    nonce=$(echo "$out" | grep -oE '"order":\{"nonce":"?[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)
    if [ -n "$nonce" ]; then relay_order "$job:$nonce"; fi
    spotn=$(echo "$out" | grep -oE '"tx":\{"chain_id":[0-9]+,"nonce":[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)
    if [ -n "$spotn" ]; then "$0" relay-spot "$spotn"; fi
    ;;
  relay-spot)
    # Anyone: broadcast the judge-signed Base exit transaction with spot-account nonce $2.
    spotn=${2:?spot nonce}
    rec=$(near_view "$G6_JUDGE" get_record "{\"key\":\"spot:$spotn\"}"); echo "$rec" > "$OUT/record-spot-$spotn.json"
    raw=$($JUDGE_BIN spot-raw "$(python3 -I -c 'import json,sys;print(json.dumps(json.loads(sys.argv[1])["tx"]))' "$rec")" \
      "$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["v"])' "$rec")" \
      "$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["r"])' "$rec")" \
      "$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["s"])' "$rec")" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["raw"])')
    echo "Base exit tx: $(cast publish "$raw" --rpc-url "$BASE")"
    ;;
  settle)
    tag=${2:?tag}
    perp=$(perp_evidence "$tag" "$AGENT")
    call "$AGENT" settle "{\"perp\":\"$perp\",\"spot\":\"$(spot_key)\"}" '0 NEAR' "$OUT/$tag-settle.txt"
    ;;
  sweep)
    tag="sweep-$(date +%s)"
    perp=$(perp_evidence "$tag" "$AGENT")
    out=$(call "$AGENT" sweep "{\"perp\":\"$perp\",\"spot\":\"$(spot_key)\"}" '0 NEAR' "$OUT/$tag.txt"); echo "$out"
    sleep_s 4
    n=$(echo "$out" | grep -oE '"sweep":\{"nonce":"?[0-9]+' | grep -oE '[0-9]+$' | head -1)
    rec=$(near_view "$G6_JUDGE" get_record "{\"key\":\"sweep:$n\"}"); echo "$rec" > "$OUT/record-sweep-$n.json"
    eval "$(python3 -I -c 'import json,sys;d=json.loads(sys.argv[1]);w=d["sweep"];print("sn=%s ntl=%s wei=%s dl=%s v=%s r=%s s=%s"%(w["nonce"],w["usd_ntl"],w["usdc_wei"],w["deadline"],d["v"],d["r"],d["s"]))' "$rec")"
    echo "sweep relayed $(send_tx "$HYPER" "$G6_LEG" "sweep(uint64,uint64,uint64,uint64,uint8,bytes32,bytes32)" "$sn" "$ntl" "$wei" "$dl" "$v" "$r" "$s")"
    ;;
  status)
    near_view "$G6_JUDGE" get_strategy '{}' | python3 -I -c '
import json,sys
s=json.load(sys.stdin); j=s.get("job")
print("mode", s["mode"], "| nonce", s["nonce"], "| spot_nonce", s.get("spot_nonce"), "| pool", int(s["pool"])/1e24, "NEAR | payouts", s["payouts"])
if j: print("job", j["id"], j["kind"], "agent", j["agent"])'
    echo "judge $G6_JUDGE keys: $(access_keys "$G6_JUDGE") | guardian $AGENT: $(python3 -I -c "print('%.4f NEAR'%(int('$(balance "$AGENT")' or 0)/1e24))")"
    echo "KeelLeg $G6_LEG: position $(cast call "$G6_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G6_LEG" --rpc-url "$HYPER" | head -1)"
    .tools/venv/bin/python scripts/testnet/relayer.py balances "$G6_LEG" | tr -d '\n '; echo
    echo "Base: spot account tWETH $(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$G6_SPOT" --rpc-url "$BASE" | cut -d' ' -f1) | investor tWETH $(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$INVESTOR" --rpc-url "$BASE" | cut -d' ' -f1)"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
