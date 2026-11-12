#!/usr/bin/env bash
# G7 bypass attempts, live: each is a real testnet call that must be refused. Results are appended to
# docs/results/g7/<strategy>/attacks.md with the transaction and the refusal.
#
#   G7=ai scripts/testnet/g7-attacks.sh pre <perp-key>        before the rescue (perp-key: attested by the guardian)
#   G7=ai scripts/testnet/g7-attacks.sh post <perp> <spot> <receipt>   after it
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
NAME=${G7:-ai}
OUT=docs/results/g7/$NAME
set -a; . "$OUT/env"; set +a
NEAR="$ROOT_DIR/node_modules/.bin/near"
HYPER=https://rpc.hyperliquid-testnet.xyz/evm
BASE=https://sepolia.base.org
REPORT=$OUT/attacks.md
J=$G7_JUDGE

plain() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }
key() { echo ".secrets/near/$1.json"; }
# <attack> <key-file> <signer> <method> <json> [deposit]: record the transaction and the refusal.
try() {
  local log="$OUT/attack-$(date +%s%N).txt"
  "$NEAR" contract call-function as-transaction "$J" "$4" json-args "$5" prepaid-gas '100.0 Tgas' attached-deposit "${6:-0 NEAR}" \
    sign-as "$3" network-config testnet sign-with-access-key-file "$2" send > "$log" 2>&1 || true
  local tx why
  tx=$(plain "$log" | grep -oE "Transaction ID: [A-Za-z0-9]+" | head -1 | cut -d' ' -f3 || true)
  why=$(plain "$log" | grep -oE "Smart contract panicked: [^\"\\\\]*|Method [a-z_]+ is private|MethodNameMismatch[^,]*|not allowed[^.]*|Exceeded[^.]*|InvalidAccessKeyError[^}]*" | head -1 || true)
  [ -n "$why" ] || why="NOT REFUSED: $(plain "$log" | tail -3 | tr '\n' ' ')"
  printf '| %s | `%s` | %s |\n' "$1" "${tx:-no transaction (rejected before inclusion)}" "$why" | tee -a "$REPORT"
}
# <attack> <rpc> <to> <sig> <args...>: an EVM call that must revert (simulated with eth_call, then sent).
evm_try() {
  local name=$1 rpc=$2 to=$3; shift 3
  local why
  why=$(cast call "$to" "$@" --rpc-url "$rpc" --from 0x1d9Db7f01d68CF06B3A2D2498af09a09f186615c 2>&1 | grep -oE 'execution reverted[^"]*|custom error [^"]*|Error: [^\n]*' | head -1 || true)
  [ -n "$why" ] || why="NOT REFUSED"
  printf '| %s | eth_call on %s | %s |\n' "$name" "$to" "$why" | tee -a "$REPORT"
}

[ -f "$REPORT" ] || printf '# G7 %s: bypass attempts (live)\n\n| Attempt | Transaction | Refusal |\n|---|---|---|\n' "$NAME" > "$REPORT"
case "${1:-}" in
  pre)
    perp=${2:?perp key attested by guardian.$J}
    spot=$(cat "$OUT/latest-spot")
    try "A stranger requests the investor's exit" "$(key "guardian.$J")" "guardian.$J" request_exit '{}'
    try "A stranger proposes a trade" "$(key "guardian.$J")" "guardian.$J" propose_order "{\"perp\":\"$perp\",\"spot\":\"$spot\",\"is_buy\":false,\"sz\":500000,\"limit_px\":198000000000}"
    try "A stranger sends the manager's heartbeat" "$(key "guardian.$J")" "guardian.$J" heartbeat '{}'
    try "The AI's restricted key calls open_flatten" "$(key "ai-fc.$J")" "ai.$J" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    try "The AI's restricted key calls request_exit" "$(key "ai-fc.$J")" "ai.$J" request_exit '{}'
    try "The manager account tries to guard" "$(key "ai.$J")" "ai.$J" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    try "Another account opens a job on the guardian's evidence" "$(key "investor.$J")" "investor.$J" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    try "Anyone calls the private attestation callback" "$(key "guardian.$J")" "guardian.$J" on_attested "{\"key\":\"$perp\",\"evidence\":\"{}\",\"expected\":\"00\",\"by\":\"guardian.$J\"}"
    try "An exit with no trigger" "$(key "guardian.$J")" "guardian.$J" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    # A forged snapshot: a fresh, finalized, never-attested log with its account value raised.
    # The judge asks Read MPC to confirm it; the network's payload hash cannot match, so nothing is stored.
    real=$(scripts/testnet/g7.sh snapshot "forge-$(date +%s)" | tail -1)
    forged=$OUT/forged-log.json
    python3 -I - "$real" "$forged" <<'PY'
import json,sys
l=json.load(open(sys.argv[1])); d=l["data"][2:]
w=[d[i:i+64] for i in range(0,len(d),64)]; w[5]=format(10**12,"064x")  # account value: 1,000,000 USD
l["data"]="0x"+"".join(w); json.dump(l,open(sys.argv[2],"w"))
PY
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"chain":"hyperevm","log":json.load(open(sys.argv[1]))}))' "$forged")
    log="$OUT/attack-forged-attest.txt"
    "$NEAR" contract call-function as-transaction "$J" attest json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
      sign-as "guardian.$J" network-config testnet sign-with-access-key-file "$(key "guardian.$J")" send > "$log" 2>&1 || true
    tx=$(plain "$log" | grep -oE "Transaction ID: [A-Za-z0-9]+" | head -1 | cut -d' ' -f3 || true)
    k=$(python3 -I -c 'import json,sys;l=json.load(open(sys.argv[1]));print("hyperevm:%s:%d"%(l["transactionHash"].lower(),int(l["logIndex"],16)))' "$forged")
    sleep 8
    stored=$(curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":sys.argv[1],"method_name":"get_attested","args_base64":base64.b64encode(json.dumps({"key":sys.argv[2]}).encode()).decode()}}))' "$J" "$k")" | python3 -I -c 'import json,sys;print(bytes(json.load(sys.stdin)["result"]["result"]).decode())')
    why=$(plain "$log" | grep -oE "not attested [^ ]+" | head -1 || true)
    printf '| A forged snapshot (account value 1M USD) sent for attestation | `%s` | judge log: "%s"; stored: %s |\n' "$tx" "${why:-?}" "$stored" | tee -a "$REPORT"
    # KeelLeg and KeelVault refuse signatures the judge did not produce.
    evm_try "A self-signed order relayed to KeelLeg" "$HYPER" "$G7_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" \
      "(0,false,198000000000,500000,false,1,9999999999)" 27 0x1111111111111111111111111111111111111111111111111111111111111111 0x2222222222222222222222222222222222222222222222222222222222222222
    evm_try "A self-signed vault exit relayed to KeelVault" "$BASE" "$G7_VAULT" "exit(address,uint64,uint64,uint8,bytes32,bytes32)" \
      0x4200000000000000000000000000000000000006 0 9999999999 27 0x1111111111111111111111111111111111111111111111111111111111111111 0x2222222222222222222222222222222222222222222222222222222222222222
    ;;
  post)
    perp=${2:?perp}; spot=${3:?spot}; receipt=${4:?receipt}
    try "Settle again after the rescue" "$(key "guardian.$J")" "guardian.$J" settle "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    try "Confirm the same exit receipt again" "$(key "guardian.$J")" "guardian.$J" confirm_exit "{\"receipt\":\"$receipt\"}"
    try "Open a second rescue" "$(key "guardian.$J")" "guardian.$J" open_flatten "{\"perp\":\"$perp\",\"spot\":\"$spot\"}"
    [ -f "$(key "ai-fc.$J")" ] && try "The AI proposes after the rescue" "$(key "ai-fc.$J")" "ai.$J" propose_order "{\"perp\":\"$perp\",\"spot\":\"$spot\",\"is_buy\":false,\"sz\":500000,\"limit_px\":198000000000}"
    ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
