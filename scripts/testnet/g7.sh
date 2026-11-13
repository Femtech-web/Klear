#!/usr/bin/env bash
# G7: the replacement judge (v3) live. An investor's mandate for an AI manager and a verified rescue
# of both legs: Hyperliquid (KeelLeg v6) and Base (KeelVault, real Base Sepolia WETH). Each strategy
# keeps its addresses in docs/results/g7/<name>/env; pick one with G7=<name> (default: ai), or point KEEL_DIR
# at another strategy's folder (the practice strategy: docs/results/practice). An env file may name its role
# accounts (G7_INVESTOR_ACCOUNT, G7_MANAGER, G7_MANAGER_KEY); the defaults are the G7 sub-accounts.
#
# Chain I/O only: decisions come from agents/ (the AI manager and guardian) or from a person.
#
#   G7=ai scripts/testnet/g7.sh accounts [manager]   judge (faucet), investor.<judge>, guardian.<judge>,
#                                                   and with `manager`: ai.<judge> plus a function-call key
#                                                   for the AI limited to propose_order and heartbeat
#   g7.sh deploy-evm                 KeelLeg v6 (HyperEVM) and KeelVault (Base); controllers derived for the
#                                    judge; both pay out only to $G7_INVESTOR
#   g7.sh fund <usdc> <weth-wei>     relayer: margin to KeelLeg; ETH -> WETH -> the vault
#   g7.sh deploy-judge <policy.json> judge with the mandate; reward pool from $G7_POOL (default 1.2 NEAR)
#   g7.sh lock                       delete the judge's only key (irreversible), check zero keys
#   g7.sh snapshot <tag>             KeelLeg snapshot only (not attested); prints the log file
#   g7.sh perp <tag> <signer>        KeelLeg snapshot -> attest (HyperEVM); prints the evidence key
#   g7.sh spot <tag> <signer>        vault Balance -> wait for Base finality (~20 min) -> attest; prints key
#   g7.sh attest <chain> <log.json> <signer>   attest a finalized log already on disk
#   g7.sh value <perp> <spot>        the judge's valuation view (liquidation value, trigger, silence)
#   g7.sh propose <perp> <spot> <buy|sell> <sz> <px>   as the AI, with its restricted key
#   g7.sh heartbeat                  as the AI, with its restricted key
#   g7.sh request-exit               as the investor
#   g7.sh open|settle|delever <perp> <spot> <signer>   (delever: open_deleverage, judge v3.1)
#   g7.sh confirm <receipt-key> <signer>
#   g7.sh relay-order <job:nonce> | relay-sweep <n> | relay-exit <n>    anyone; prints the tx
#   g7.sh receipt <exit-tx> <signer>  wait for Base finality, attest the vault's Exited log; prints key
#   g7.sh rearm                      as the investor, after a rescue: the same mandate, a new cycle (v3.1)
#   g7.sh fund-pool <NEAR>           anyone: top up the reward pool (v3.1)
#   g7.sh status | judge-status      the full strategy | the judge's one-call status view (v3.1)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

NAME=${G7:-ai}
OUT=${KEEL_DIR:-docs/results/g7/$NAME}
mkdir -p "$OUT"
STATE=$OUT/env
[ -f "$STATE" ] && set -a && . "$STATE" && set +a

G7_INVESTOR=${G7_INVESTOR:-0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4}
WETH=0x4200000000000000000000000000000000000006   # Base Sepolia's canonical WETH predeploy
MPC=v1.signer-prod.testnet
NEAR_RPC=https://test.rpc.fastnear.com   # rpc.testnet.near.org is deprecated and answers 429
HYPER=https://rpc.hyperliquid-testnet.xyz/evm
BASE=https://sepolia.base.org
NEAR="$ROOT_DIR/node_modules/.bin/near"
WASM=contracts/near-keel/target/near/near_keel.wasm
JUDGE_BIN=./target/debug/keel-judge
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)

# A signer's key file: .secrets/near/<account>.json, or under $KEEL_KEYS (a visiting guardian's own key, agents/rescue.py).
key() { local f=".secrets/near/$1.json"; [ -f "$f" ] || [ -z "${KEEL_KEYS:-}" ] || f="$KEEL_KEYS/$1.json"; echo "$f"; }
put() { touch "$STATE"; grep -q "^$1=" "$STATE" && sed -i '' "s|^$1=.*|$1=$2|" "$STATE" || echo "$1=$2" >> "$STATE"; export "$1=$2"; }
sleep_s() { python3 -I -c "import time,sys;time.sleep(float(sys.argv[1]))" "$1"; }
plain() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }
# curl with retries: --fail keeps an error reply's body out, and the temp file is truncated before each retry,
# so a rate-limited attempt can never glue its reply to the next one.
fetch() { local f rc; f=$(mktemp); curl -s --fail --retry 5 --retry-all-errors --retry-delay 3 -o "$f" "$@"; rc=$?; cat "$f"; rm -f "$f"; return $rc; }
near_rpc() { fetch "$NEAR_RPC" -H 'content-type: application/json' -d "$1"; }
near_view() { # <account> <method> <json>
  near_rpc "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$1" "$2" "$3")" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);res=(r.get("result") or {}).get("result")
if res is None: sys.exit("view failed: "+json.dumps(r.get("error") or r.get("result"))[:400])
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
# <key-file> <signer> <method> <json> <deposit> <log>: prints the tx id, the outcome JSON or the panic.
# GAS (Tgas) defaults to 300; a function-call key's allowance is charged the full prepaid amount.
call_with() {
  "$NEAR" contract call-function as-transaction "$G7_JUDGE" "$3" json-args "$4" prepaid-gas "${GAS:-300}.0 Tgas" attached-deposit "$5" \
    sign-as "$2" network-config testnet sign-with-access-key-file "$1" send > "$6" 2>&1 || true
  plain "$6" | grep -oE "Transaction ID: [A-Za-z0-9]+" | head -1
  plain "$6" | grep -oE 'Smart contract panicked: [^"\\]*' | head -1 || true
  plain "$6" | grep -oE '\{"outcome".*\}' | head -1 || true
}
call() { call_with "$(key "$1")" "$@"; }
derive() {
  local k
  k=$(near_view "$MPC" derived_public_key "{\"path\":\"$1\",\"predecessor\":\"$G7_JUDGE\",\"domain_id\":0}" | tr -d '"')
  $JUDGE_BIN evm-address "$k" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}
send_tx() { local rpc=$1; shift; cast send "$@" --rpc-url "$rpc" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(r["transactionHash"]) if r.get("status")=="0x1" else sys.exit("send failed: "+json.dumps(r)[:240])'; }
finalized() { local bn; bn=$(cast receipt "$2" blockNumber --rpc-url "$1"); until [ "$(cast block finalized --field number --rpc-url "$1")" -ge "$bn" ]; do sleep_s 10; done; }
receipt_log() { # <rpc> <tx> <emitter> [topic0]
  cast receipt "$2" --rpc-url "$1" --json | python3 -I -c '
import json,sys
r=json.load(sys.stdin); a=sys.argv[1].lower(); t=sys.argv[2] if len(sys.argv)>2 else None
logs=[l for l in r["logs"] if l["address"].lower()==a and (t is None or l["topics"][0].lower()==t.lower())]
print(json.dumps(logs[-1]))' "$3" ${4:-}
}
evidence_key() { python3 -I -c 'import json,sys;l=json.load(open(sys.argv[2]));print("%s:%s:%d"%(sys.argv[1],l["transactionHash"].lower(),int(l["logIndex"],16)))' "$1" "$2"; }
attest() { # <chain> <log.json> <signer>: the signer becomes the attester of record
  local args; args=$(python3 -I -c 'import json,sys;print(json.dumps({"chain":sys.argv[2],"log":json.load(open(sys.argv[1]))}))' "$2" "$1")
  call "$3" attest "$args" '1 yoctoNEAR' "${2%.json}-attest.txt" >/dev/null
  near_view "$G7_JUDGE" get_attested "{\"key\":\"$(evidence_key "$1" "$2")\"}" | python3 -I -c 'import json,sys;v=json.load(sys.stdin);sys.exit(0 if v else "not attested")'
}
code_hash() {
  near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys,base64,hashlib;r=json.load(sys.stdin).get("result");print(hashlib.sha256(base64.b64decode(r["code_base64"])).hexdigest() if r else "none")'
}
record() { near_view "$G7_JUDGE" get_record "{\"key\":\"$1\"}"; }
vrs() { python3 -I -c 'import json,sys;d=json.loads(sys.argv[1]);print(d["v"],d["r"],d["s"])' "$1"; }
fields() { python3 -I -c 'import json,sys;d=json.loads(sys.argv[1])[sys.argv[2]];print(" ".join(str(d[k]) for k in sys.argv[3:]))' "$@"; }
weth_of() { cast call "$WETH" 'balanceOf(address)(uint256)' "$1" --rpc-url "$BASE" | cut -d' ' -f1; }

case "${1:-}" in
  accounts)
    [ -n "${G7_JUDGE:-}" ] || put G7_JUDGE "keel-$NAME-$(openssl rand -hex 3).testnet"
    subs=(investor guardian); [ "${2:-}" = manager ] && subs+=(ai)
    for a in "$G7_JUDGE" "${subs[@]/%/.$G7_JUDGE}"; do
      [ -f "$(key "$a")" ] || node scripts/keys/gen_near_key.mjs "$a" "$(key "$a")" >/dev/null
    done
    if [ -z "$(balance "$G7_JUDGE")" ]; then
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$G7_JUDGE")")
      "$NEAR" account create-account sponsor-by-faucet-service "$G7_JUDGE" use-manually-provided-public-key "$pk" network-config testnet create > "$OUT/create-judge.txt" 2>&1
      for _ in $(seq 1 30); do [ -n "$(balance "$G7_JUDGE")" ] && break; sleep_s 2; done
    fi
    for s in "${subs[@]}"; do
      a="$s.$G7_JUDGE"
      [ -n "$(balance "$a")" ] && continue
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$a")")
      "$NEAR" account create-account fund-myself "$a" '1 NEAR' use-manually-provided-public-key "$pk" \
        sign-as "$G7_JUDGE" network-config testnet sign-with-access-key-file "$(key "$G7_JUDGE")" send > "$OUT/create-$s.txt" 2>&1
    done
    if [ "${2:-}" = manager ] && [ ! -f "$(key "ai-fc.$G7_JUDGE")" ]; then
      # The AI's own key: a function-call key for the judge's propose_order and heartbeat only, with a
      # 0.5 NEAR gas allowance. It cannot transfer, attach deposits, or call anything else.
      node scripts/keys/gen_near_key.mjs "ai.$G7_JUDGE" "$(key "ai-fc.$G7_JUDGE")" >/dev/null
      pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "ai-fc.$G7_JUDGE")")
      "$NEAR" account add-key "ai.$G7_JUDGE" grant-function-call-access --allowance '0.5 NEAR' --contract-account-id "$G7_JUDGE" \
        --function-names propose_order,heartbeat use-manually-provided-public-key "$pk" \
        network-config testnet sign-with-access-key-file "$(key "ai.$G7_JUDGE")" send > "$OUT/ai-key.txt" 2>&1
      plain "$OUT/ai-key.txt" | grep -E "Transaction ID|Error" | head -2
    fi
    for a in "$G7_JUDGE" "${subs[@]/%/.$G7_JUDGE}"; do echo "$a: $(python3 -I -c "print('%.3f NEAR'%(int('$(balance "$a")' or 0)/1e24))")"; done
    ;;
  deploy-evm)
    ctrl=$(derive "keel/1/hyperevm"); spotc=$(derive "keel/1/spot")
    leg=$(cd contracts/evm && forge create src/KeelLeg.sol:KeelLeg --rpc-url "$HYPER" --keystore ../../.secrets/evm/relayer \
      --password-file ../../.secrets/evm/relayer.password --broadcast --constructor-args "$ctrl" "$G7_INVESTOR" 4 4 1000000 100 500 | awk '/Deployed to/{print $3}')
    vault=$(cd contracts/evm && forge create src/KeelVault.sol:KeelVault --rpc-url "$BASE" --keystore ../../.secrets/evm/relayer \
      --password-file ../../.secrets/evm/relayer.password --broadcast --constructor-args "$spotc" "$G7_INVESTOR" | awk '/Deployed to/{print $3}')
    put G7_CONTROLLER "$ctrl"; put G7_VAULT_CONTROLLER "$spotc"; put G7_LEG "$leg"; put G7_VAULT "$vault"
    echo "KeelLeg.controller=$(cast call "$leg" 'controller()(address)' --rpc-url "$HYPER") payout=$(cast call "$leg" 'payout()(address)' --rpc-url "$HYPER")" | tee "$OUT/evm.txt"
    echo "KeelVault.controller=$(cast call "$vault" 'controller()(address)' --rpc-url "$BASE") payout=$(cast call "$vault" 'payout()(address)' --rpc-url "$BASE")" | tee -a "$OUT/evm.txt"
    printf 'leg=%s\nvault=%s\n' "$leg" "$vault" | tee -a "$OUT/evm.txt"
    ;;
  fund)
    usdc=${2:?usdc}; wei=${3:?weth wei}
    .tools/venv/bin/python -I scripts/testnet/relayer.py to-perp "$usdc" >/dev/null
    .tools/venv/bin/python -I scripts/testnet/relayer.py send-perp-usdc "$G7_LEG" "$usdc" >/dev/null
    echo "wrap ETH:     $(send_tx "$BASE" "$WETH" "deposit()" --value "$wei")"
    echo "WETH -> vault: $(send_tx "$BASE" "$WETH" "transfer(address,uint256)" "$G7_VAULT" "$wei")"
    echo "vault WETH: $(weth_of "$G7_VAULT")"
    .tools/venv/bin/python -I scripts/testnet/relayer.py balances "$G7_LEG" | tail -8
    ;;
  deploy-judge)
    policy=${2:?policy json file}
    cfg=$(python3 -I -c '
import json,os,sys
p=json.load(open(sys.argv[1])); j=os.environ["G7_JUDGE"]
c={"strategy_id":int(p.pop("strategy_id")),"chain_id":998,"leg":os.environ["G7_LEG"],"spot_account":os.environ["G7_VAULT"],
 "spot_token":sys.argv[2],"probe":os.environ["G7_VAULT"],"spot_chain":"base","spot_chain_id":84532,
 "investor":sys.argv[3],"investor_account":"investor."+j,"policy":p}
if p.pop("with_manager",False): c["manager"]="ai."+j
print(json.dumps(c))' "$policy" "$WETH" "$G7_INVESTOR")
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"owner":sys.argv[1],"mpc":sys.argv[2],"sign_path":"keel/1/hyperevm","sign_domain":0,"foreign_tx_domain":3,"spot_path":"keel/1/spot","config":json.loads(sys.argv[3])}))' "investor.$G7_JUDGE" "$MPC" "$cfg")
    echo "$args" | python3 -I -m json.tool > "$OUT/init-args.json"
    "$NEAR" contract deploy "$G7_JUDGE" use-file "$WASM" with-init-call new json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit "${G7_POOL:-1.2 NEAR}" \
      network-config testnet sign-with-access-key-file "$(key "$G7_JUDGE")" send > "$OUT/deploy-judge.txt" 2>&1
    plain "$OUT/deploy-judge.txt" | grep -E "Transaction ID|successfully|Error|panicked" | head -3
    shasum -a 256 "$WASM" | tee -a "$OUT/deploy-judge.txt"
    ;;
  lock)
    pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$G7_JUDGE")")
    "$NEAR" account delete-keys "$G7_JUDGE" public-keys "$pk" network-config testnet sign-with-access-key-file "$(key "$G7_JUDGE")" send > "$OUT/lock.txt" 2>&1
    plain "$OUT/lock.txt" | grep -E "Transaction ID|Error" | head -2
    echo "access keys on $G7_JUDGE: $(access_keys "$G7_JUDGE")"
    ;;
  snapshot)
    # A finalized KeelLeg snapshot log, not attested; prints the log file.
    tag=${2:?tag}
    tx=$(send_tx "$HYPER" "$G7_LEG" "snapshot(bytes32)" "$(cast format-bytes32-string "$tag")")
    finalized "$HYPER" "$tx"; receipt_log "$HYPER" "$tx" "$G7_LEG" > "$OUT/$tag-perp-log.json"
    echo "$OUT/$tag-perp-log.json"
    ;;
  perp)
    tag=${2:?tag}; signer=${3:?signer}
    tx=$(send_tx "$HYPER" "$G7_LEG" "snapshot(bytes32)" "$(cast format-bytes32-string "$tag")")
    finalized "$HYPER" "$tx"; receipt_log "$HYPER" "$tx" "$G7_LEG" > "$OUT/$tag-perp-log.json"
    attest hyperevm "$OUT/$tag-perp-log.json" "$signer"
    evidence_key hyperevm "$OUT/$tag-perp-log.json"
    ;;
  spot)
    tag=${2:?tag}; signer=${3:?signer}
    tx=$(send_tx "$BASE" "$G7_VAULT" "probe(address,bytes32)" "$WETH" "$(cast format-bytes32-string "$tag")")
    finalized "$BASE" "$tx"; receipt_log "$BASE" "$tx" "$G7_VAULT" > "$OUT/$tag-spot-log.json"
    attest base "$OUT/$tag-spot-log.json" "$signer"
    evidence_key base "$OUT/$tag-spot-log.json" | tee "$OUT/latest-spot"
    ;;
  attest)
    # An already-finalized log file: attest it and print its key (base logs also become the latest spot).
    chain=${2:?hyperevm|base}; file=${3:?log json}; signer=${4:?signer}
    attest "$chain" "$file" "$signer"
    k=$(evidence_key "$chain" "$file"); [ "$chain" = base ] && echo "$k" > "$OUT/latest-spot"; echo "$k"
    ;;
  value)
    near_view "$G7_JUDGE" valuation "{\"perp\":\"${2:?perp}\",\"spot\":\"${3:?spot}\"}"
    ;;
  propose)
    # An optional 7th argument, a sealed manager's receipt (JSON), rides in the call's arguments: the judge ignores
    # it, and it stays on chain with the order it explains (agents/keel_agents/sealed.py).
    args=$(python3 -I -c 'import json,sys;a={"perp":sys.argv[1],"spot":sys.argv[2],"is_buy":sys.argv[3]=="buy","sz":int(sys.argv[4]),"limit_px":int(sys.argv[5])};a.update({"sealed":json.loads(sys.argv[6])} if len(sys.argv)>6 and sys.argv[6] else {});print(json.dumps(a))' "$2" "$3" "$4" "$5" "$6" "${7:-}")
    GAS=120 call_with "$(key "${G7_MANAGER_KEY:-ai-fc.$G7_JUDGE}")" "${G7_MANAGER:-ai.$G7_JUDGE}" propose_order "$args" '0 NEAR' "$OUT/propose-$(date +%s).txt"
    ;;
  heartbeat)
    # An optional JSON argument, a sealed manager's receipt for a hold, rides in the call's arguments like propose's.
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"sealed":json.loads(sys.argv[1])} if len(sys.argv)>1 and sys.argv[1] else {}))' "${2:-}")
    GAS=30 call_with "$(key "${G7_MANAGER_KEY:-ai-fc.$G7_JUDGE}")" "${G7_MANAGER:-ai.$G7_JUDGE}" heartbeat "$args" '0 NEAR' "$OUT/heartbeat-$(date +%s).txt"
    ;;
  request-exit)
    call "${G7_INVESTOR_ACCOUNT:-investor.$G7_JUDGE}" request_exit '{}' '0 NEAR' "$OUT/request-exit-$(date +%s).txt"
    ;;
  rearm)
    call "${G7_INVESTOR_ACCOUNT:-investor.$G7_JUDGE}" rearm '{}' '0 NEAR' "$OUT/rearm-$(date +%s).txt"
    ;;
  fund-pool)
    call "${3:-${G7_INVESTOR_ACCOUNT:-investor.$G7_JUDGE}}" fund_pool '{}' "${2:?NEAR} NEAR" "$OUT/fund-pool-$(date +%s).txt"
    ;;
  judge-status)
    near_view "$G7_JUDGE" status '{}'
    ;;
  open|settle|delever)
    case "$1" in open) m=open_flatten ;; delever) m=open_deleverage ;; *) m=settle ;; esac
    call "${4:?signer}" "$m" "{\"perp\":\"${2:?perp}\",\"spot\":\"${3:?spot}\"}" '0 NEAR' "$OUT/$1-$(date +%s).txt"
    ;;
  confirm)
    call "${3:?signer}" confirm_exit "{\"receipt\":\"${2:?receipt key}\"}" '0 NEAR' "$OUT/confirm-$(date +%s).txt"
    ;;
  relay-order)
    rec=$(record "${2:?job:nonce}"); [ "$rec" != "null" ] || { echo "no signature for $2 yet" >&2; exit 1; }
    echo "$rec" > "$OUT/record-${2/:/-}.json"
    tuple=$(python3 -I -c 'import json,sys;o=json.loads(sys.argv[1])["order"];print("(%s,%s,%s,%s,%s,%s,%s)"%(o["nonce"],str(o["is_buy"]).lower(),o["limit_px"],o["sz"],str(o["reduce_only"]).lower(),o["cloid"],o["deadline"]))' "$rec")
    read -r v r s <<< "$(vrs "$rec")"
    before=$(cast call "$G7_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G7_LEG" --rpc-url "$HYPER" | head -1)
    echo "relayed $(send_tx "$HYPER" "$G7_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" "$tuple" "$v" "$r" "$s")"
    python3 -I scripts/testnet/watch.py "$G7_LEG" "$before" 60
    ;;
  relay-sweep)
    rec=$(record "sweep:${2:?nonce}"); [ "$rec" != "null" ] || { echo "no sweep signature yet" >&2; exit 1; }
    echo "$rec" > "$OUT/record-sweep-$2.json"
    read -r n ntl wei dl <<< "$(fields "$rec" sweep nonce usd_ntl usdc_wei deadline)"
    read -r v r s <<< "$(vrs "$rec")"
    echo "sweep relayed $(send_tx "$HYPER" "$G7_LEG" "sweep(uint64,uint64,uint64,uint64,uint8,bytes32,bytes32)" "$n" "$ntl" "$wei" "$dl" "$v" "$r" "$s")"
    ;;
  relay-exit)
    rec=$(record "exit:${2:?vault nonce}"); [ "$rec" != "null" ] || { echo "no exit signature yet" >&2; exit 1; }
    echo "$rec" > "$OUT/record-exit-$2.json"
    read -r n token dl <<< "$(fields "$rec" exit nonce token deadline)"
    read -r v r s <<< "$(vrs "$rec")"
    tx=$(send_tx "$BASE" "$G7_VAULT" "exit(address,uint64,uint64,uint8,bytes32,bytes32)" "$token" "$n" "$dl" "$v" "$r" "$s")
    echo "$tx" > "$OUT/exit-$2.tx"; echo "exit relayed $tx"
    ;;
  receipt)
    tx=${2:?exit tx}; signer=${3:?signer}
    finalized "$BASE" "$tx"
    receipt_log "$BASE" "$tx" "$G7_VAULT" "$(cast keccak 'Exited(uint64,address,address,uint256,uint256,uint256)')" > "$OUT/exited-$tx.json"
    attest base "$OUT/exited-$tx.json" "$signer"
    evidence_key base "$OUT/exited-$tx.json"
    ;;
  status)
    echo "judge $G7_JUDGE  keys: $(access_keys "$G7_JUDGE")  code sha256: $(code_hash "$G7_JUDGE")  local build: $(shasum -a 256 "$WASM" | cut -c1-64)"
    near_view "$G7_JUDGE" get_strategy '{}' | python3 -I -c '
import json,sys
s=json.load(sys.stdin); r=s["rescue"]
print("mode", s["mode"], "| nonce", s["nonce"], "| pool %.3f NEAR" % (int(s["pool"])/1e24), "| exit requested", s["exit_requested"])
print("rescue: trigger", r["trigger"], "| perp", r["perp"], "| spot", r["spot"], "| sweep", r["sweep"], "| exit", r["exit"], "| vault nonce", r["vault_nonce"])
for p in s["payouts"]: print("paid %.3f NEAR to %s for %s (job %s)" % (int(p["amount"])/1e24, p["agent"], p["reason"], p["job_id"]))
for d in r["deliveries"]: print("delivered", d["leg"], d["amount"], "evidence", d["evidence"])'
    echo "investor: Base WETH $(weth_of "$G7_INVESTOR")  | vault WETH $(weth_of "$G7_VAULT")"
    .tools/venv/bin/python -I scripts/testnet/relayer.py balances "$G7_LEG" | python3 -I -c 'import json,sys;d=json.load(sys.stdin);print("leg:", d)' 2>/dev/null || true
    ;;
  *)
    sed -n '2,30p' "$0"; exit 2 ;;
esac
