#!/usr/bin/env bash
# G4: the Keel judge on NEAR testnet runs the loop on-chain and pays an independent agent once.
#
#   scripts/testnet/g4.sh accounts            judge.<root> (contract) and agent.<root> (the repairer)
#   scripts/testnet/g4.sh deploy-evm          TestWETH + BalanceProbe (spot stand-in) and KeelLeg v3 on
#                                             HyperEVM; KeelLeg's controller is the judge's derived key
#   scripts/testnet/g4.sh fund <usdc>         relayer -> KeelLeg v3 perp margin
#   scripts/testnet/g4.sh deploy-judge        near_keel.wasm on judge.<root>, init with the policy; the
#                                             init deposit (1 NEAR) is the reward pool
#   scripts/testnet/g4.sh evidence <tag>      relayer emits Snapshot + Balance logs, waits for finality
#   scripts/testnet/g4.sh attest <tag>        agent: judge.attest for both logs (Read MPC)
#   scripts/testnet/g4.sh open|settle <tag>   agent: judge.open_repair / judge.settle on that evidence
#   scripts/testnet/g4.sh relay <job> <nonce> relayer: the judge's signed order -> KeelLeg v3, watch fill
#   scripts/testnet/g4.sh status              judge strategy, agent balance, legs
#
# Keys: .secrets/near/<account>.json and .secrets/evm/relayer (never printed). Results: docs/results/g4/.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

ROOT=${KEEL_NEAR_ACCOUNT:?run make keys}
JUDGE="judge.$ROOT"
AGENT="agent.$ROOT"
MPC=v1.signer-prod.testnet
NEAR_RPC=https://test.rpc.fastnear.com
RPC=https://rpc.hyperliquid-testnet.xyz/evm
NEAR="$ROOT_DIR/node_modules/.bin/near"
WASM=contracts/near-keel/target/near/near_keel.wasm
JUDGE_BIN=./target/debug/keel-judge
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)
OUT=docs/results/g4
mkdir -p "$OUT"

key() { echo ".secrets/near/$1.json"; }
setenv() { grep -q "^$1=" .env && sed -i '' "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; export "$1=$2"; }

near_view() { # <contract> <method> <json>
  curl -s "$NEAR_RPC" -H 'content-type: application/json' -d "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$1" "$2" "$3")" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);res=(r.get("result") or {}).get("result")
if res is None: sys.exit("view failed: "+json.dumps(r)[:300])
print(bytes(res).decode())'
}

balance() {
  curl -s "$NEAR_RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print(r["amount"] if r else "")'
}

call() { # <signer> <method> <json> <deposit> <log>
  "$NEAR" contract call-function as-transaction "$JUDGE" "$2" json-args "$3" prepaid-gas '200.0 Tgas' attached-deposit "$4" \
    sign-as "$1" network-config testnet sign-with-access-key-file "$(key "$1")" send > "$5" 2>&1 || true
  sed 's/\x1b\[[0-9;]*m//g' "$5" | grep -E "Transaction ID|Smart contract panicked|succeeded|failed|Error" | head -4
}

derive() { # <path>
  local k
  k=$(near_view "$MPC" derived_public_key "{\"path\":\"$1\",\"predecessor\":\"$JUDGE\",\"domain_id\":0}" | tr -d '"')
  $JUDGE_BIN evm-address "$k" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}

receipt_log() { # <tx> <emitter> -> the emitter's last log in the receipt, as JSON
  cast receipt "$1" --rpc-url "$RPC" --json |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(json.dumps([l for l in r["logs"] if l["address"].lower()==sys.argv[1].lower()][-1]))' "$2"
}

finalized() { # <tx>
  local bn
  bn=$(cast receipt "$1" blockNumber --rpc-url "$RPC")
  until [ "$(cast block finalized --field number --rpc-url "$RPC")" -ge "$bn" ]; do python3 -I -c "import time;time.sleep(1)"; done
}

evidence_key() { # <log.json>
  python3 -I -c 'import json,sys;l=json.load(open(sys.argv[1]));print("hyperevm:%s:%d"%(l["transactionHash"].lower(),int(l["logIndex"],16)))' "$1"
}

case "${1:-}" in
  accounts)
    for acct in "$JUDGE:4.5" "$AGENT:0.5"; do
      name=${acct%%:*}; amount=${acct##*:}
      [ -f "$(key "$name")" ] || node scripts/keys/gen_near_key.mjs "$name" "$(key "$name")" >/dev/null
      if [ -z "$(balance "$name")" ]; then
        pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$name")")
        "$NEAR" account create-account fund-myself "$name" "$amount NEAR" use-manually-provided-public-key "$pk" \
          sign-as "$ROOT" network-config testnet sign-with-access-key-file "$(key "$ROOT")" send > "$OUT/create-$name.txt" 2>&1
      fi
      echo "$name: $(python3 -I -c "print('%.3f NEAR'%(int('$(balance "$name")' or 0)/1e24))")"
    done
    ;;
  deploy-evm)
    ctrl=$(derive "keel/1/hyperevm"); spot=$(derive "keel/1/spot")
    echo "judge controller $ctrl | spot account $spot"
    cd contracts/evm
    token=$(forge create src/testnet/TestWETH.sol:TestWETH --rpc-url "$RPC" --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast | awk '/Deployed to/{print $3}')
    probe=$(forge create src/BalanceProbe.sol:BalanceProbe --rpc-url "$RPC" --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast | awk '/Deployed to/{print $3}')
    leg=$(forge create src/KeelLeg.sol:KeelLeg --rpc-url "$RPC" --keystore ../../.secrets/evm/relayer --password-file ../../.secrets/evm/relayer.password --broadcast \
      --constructor-args "$ctrl" "$KEEL_PAYOUT" 4 4 1000000 100 500 | awk '/Deployed to/{print $3}')
    cd "$ROOT_DIR"
    # The hedge as the operator left it: 0.006 WETH bought, the short never placed.
    cast send "$token" "mint(address,uint256)" "$spot" 6000000000000000 --rpc-url "$RPC" "${RELAYER[@]}" >/dev/null
    setenv G4_CONTROLLER "$ctrl"; setenv G4_SPOT "$spot"; setenv G4_TOKEN "$token"; setenv G4_PROBE "$probe"; setenv G4_LEG "$leg"
    printf 'controller=%s\nspot=%s\ntoken=%s\nprobe=%s\nleg=%s\n' "$ctrl" "$spot" "$token" "$probe" "$leg" | tee "$OUT/evm-deployments.txt"
    ;;
  fund)
    .tools/venv/bin/python scripts/testnet/relayer.py to-perp "${2:?usdc}" >/dev/null
    .tools/venv/bin/python scripts/testnet/relayer.py send-perp-usdc "$G4_LEG" "$2" >/dev/null
    .tools/venv/bin/python scripts/testnet/relayer.py balances "$G4_LEG"
    ;;
  deploy-judge)
    cfg=$(python3 -I -c '
import json,os
print(json.dumps({"strategy_id":1,"chain_id":998,"leg":os.environ["G4_LEG"],"spot_account":os.environ["G4_SPOT"],
 "spot_token":os.environ["G4_TOKEN"],"probe":os.environ["G4_PROBE"],"spot_chain":"hyperevm",
 "policy":{"perp":4,"sz_decimals":4,"band_bp":100,"max_basis_bp":500,"fee_bp":5,"max_order_sz":1000000,
  "tolerance":100000,"max_loss_usd6":2000000,"settle_delay_l1":300,"max_evidence_age_s":900,"order_ttl_s":300,
  "job_ttl_s":7200,"max_failed_attempts":3,"dust":10000,
  "repair_reward":"500000000000000000000000","flatten_reward":"500000000000000000000000"}}))')
    args=$(python3 -I -c 'import json,sys;print(json.dumps({"owner":sys.argv[1],"mpc":sys.argv[2],"sign_path":"keel/1/hyperevm","sign_domain":0,"foreign_tx_domain":3,"config":json.loads(sys.argv[3])}))' "$ROOT" "$MPC" "$cfg")
    echo "$args" > "$OUT/init-args.json"
    "$NEAR" contract deploy "$JUDGE" use-file "$WASM" with-init-call new json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit '1 NEAR' \
      network-config testnet sign-with-access-key-file "$(key "$JUDGE")" send > "$OUT/deploy-judge.txt" 2>&1
    sed 's/\x1b\[[0-9;]*m//g' "$OUT/deploy-judge.txt" | grep -E "Transaction ID|successfully|Error|panicked" | head -3
    shasum -a 256 "$WASM" | tee -a "$OUT/deploy-judge.txt"
    ;;
  evidence)
    tag=${2:?tag}; b32=$(cast format-bytes32-string "$tag")
    tx1=$(cast send "$G4_LEG" "snapshot(bytes32)" "$b32" --rpc-url "$RPC" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
    tx2=$(cast send "$G4_PROBE" "probe(address,address,bytes32)" "$G4_SPOT" "$G4_TOKEN" "$b32" --rpc-url "$RPC" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
    finalized "$tx1"; finalized "$tx2"
    receipt_log "$tx1" "$G4_LEG" > "$OUT/$tag-perp-log.json"
    receipt_log "$tx2" "$G4_PROBE" > "$OUT/$tag-spot-log.json"
    echo "perp $(evidence_key "$OUT/$tag-perp-log.json")"
    echo "spot $(evidence_key "$OUT/$tag-spot-log.json")"
    ;;
  attest)
    tag=${2:?tag}
    for leg in perp spot; do
      args=$(python3 -I -c 'import json,sys;print(json.dumps({"chain":"hyperevm","log":json.load(open(sys.argv[1]))}))' "$OUT/$tag-$leg-log.json")
      echo "attest $leg:"; call "$AGENT" attest "$args" '1 yoctoNEAR' "$OUT/$tag-$leg-attest.txt"
      near_view "$JUDGE" get_attested "{\"key\":\"$(evidence_key "$OUT/$tag-$leg-log.json")\"}" | python3 -I -c 'import json,sys;v=json.load(sys.stdin);print("  stored:", "yes" if v else "NO")'
    done
    ;;
  open|settle)
    tag=${2:?tag}; method=$([ "$1" = open ] && echo open_repair || echo settle)
    args="{\"perp\":\"$(evidence_key "$OUT/$tag-perp-log.json")\",\"spot\":\"$(evidence_key "$OUT/$tag-spot-log.json")\"}"
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
    before=$(cast call "$G4_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G4_LEG" --rpc-url "$RPC" | head -1)
    cast send "$G4_LEG" "order((uint64,bool,uint64,uint64,bool,uint128,uint64),uint8,bytes32,bytes32)" "$tuple" "$v" "$r" "$s" \
      --rpc-url "$RPC" "${RELAYER[@]}" --json > "$OUT/relay-$job-$nonce.json"
    echo "relayed $(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["transactionHash"])' "$OUT/relay-$job-$nonce.json")"
    python3 -I scripts/testnet/watch.py "$G4_LEG" "$before" 60 | tee "$OUT/fill-$job-$nonce.json"
    ;;
  status)
    near_view "$JUDGE" get_strategy '{}' | python3 -I -c '
import json,sys
s=json.load(sys.stdin); j=s.get("job")
print("mode", s["mode"], "| nonce", s["nonce"], "| pool", int(s["pool"])/1e24, "NEAR | payouts", s["payouts"])
if j: print("job", j["id"], j["kind"], "agent", j["agent"], "| signed", j["signed"], "failed", j["failed"], "| order", j["attempt"]["order"])'
    echo "agent $AGENT: $(python3 -I -c "print('%.4f NEAR'%(int('$(balance "$AGENT")' or 0)/1e24))")"
    echo "KeelLeg v3 $G4_LEG: position $(cast call "$G4_LEG" 'readPosition(address)(int64,uint64,uint64,uint64)' "$G4_LEG" --rpc-url "$RPC" | head -1) | tWETH at spot account $(cast call "$G4_TOKEN" 'balanceOf(address)(uint256)' "$G4_SPOT" --rpc-url "$RPC")"
    ;;
  *)
    sed -n '2,16p' "$0"; exit 2 ;;
esac
