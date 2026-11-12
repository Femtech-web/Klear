#!/usr/bin/env bash
# Keel's factory on testnet: self-serve strategies. The factory (NEAR) creates each judge locked from birth
# and keeps the public registry; KeelDeployer (HyperEVM, Base) creates each strategy's KeelLeg and KeelVault
# at CREATE2 addresses known before anything exists. State: docs/results/factory/env.
#
#   scripts/testnet/factory.sh account          a faucet account for the factory
#   scripts/testnet/factory.sh deploy           deploy and initialize the factory (it embeds the judge it creates)
#   scripts/testnet/factory.sh lock             delete the factory's only key (irreversible): its code is final
#   scripts/testnet/factory.sh deployers        KeelDeployer on HyperEVM testnet and Base Sepolia (the relayer pays)
#   scripts/testnet/factory.sh predict <name> <investor-evm> [policy.json]
#                                               the judge id, its two MPC controllers, and the KeelLeg and
#                                               KeelVault addresses, before anything is created
#   scripts/testnet/factory.sh create <name> <policy.json> <investor-evm> <investor-near> <pool-near> [manager]
#                                               create the judge through the factory (signed by $CREATOR), then
#                                               the two EVM accounts at the predicted addresses; verify all four
#   scripts/testnet/factory.sh list             the registry, with each judge's status
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi

OUT=docs/results/factory
mkdir -p "$OUT"
STATE=$OUT/env
[ -f "$STATE" ] && set -a && . "$STATE" && set +a

MPC=v1.signer-prod.testnet
NEAR_RPC=https://rpc.testnet.near.org
HYPER=https://rpc.hyperliquid-testnet.xyz/evm
BASE=https://sepolia.base.org
NEAR="$ROOT_DIR/node_modules/.bin/near"
WASM=contracts/near-keel-factory/target/near/near_keel_factory.wasm
JUDGE_BIN=./target/debug/keel-judge
RELAYER=(--keystore .secrets/evm/relayer --password-file .secrets/evm/relayer.password)
CREATOR=${CREATOR:-agent.${KEEL_NEAR_ACCOUNT:?run make keys}}

key() { echo ".secrets/near/$1.json"; }
put() { touch "$STATE"; grep -q "^$1=" "$STATE" && sed -i '' "s|^$1=.*|$1=$2|" "$STATE" || echo "$1=$2" >> "$STATE"; export "$1=$2"; }
plain() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }
near_rpc() { curl -s "$NEAR_RPC" -H 'content-type: application/json' -d "$1"; }
near_view() { # <account> <method> <json>
  near_rpc "$(python3 -I -c '
import json,sys,base64
print(json.dumps({"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final",
 "account_id":sys.argv[1],"method_name":sys.argv[2],"args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$1" "$2" "$3")" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin);res=(r.get("result") or {}).get("result")
if res is None: sys.exit("view failed: "+json.dumps(r.get("error") or r.get("result"))[:400])
print(bytes(res).decode())'
}
access_keys() {
  near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys;r=json.load(sys.stdin).get("result");print(len(r["keys"]) if r else "missing")'
}
code_hash() {
  near_rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    python3 -I -c 'import json,sys,base64,hashlib;r=json.load(sys.stdin).get("result");print(hashlib.sha256(base64.b64decode(r["code_base64"])).hexdigest() if r else "none")'
}
derive() { # <judge> <path>: the EVM address of the MPC key derived for that judge and path
  local k
  k=$(near_view "$MPC" derived_public_key "{\"path\":\"$2\",\"predecessor\":\"$1\",\"domain_id\":0}" | tr -d '"')
  $JUDGE_BIN evm-address "$k" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["address"])'
}
send_tx() { local rpc=$1; shift; cast send "$@" --rpc-url "$rpc" "${RELAYER[@]}" --json | python3 -I -c 'import json,sys;r=json.load(sys.stdin);print(r["transactionHash"]) if r["status"]=="0x1" else sys.exit("reverted: "+r["transactionHash"])'; }
# The leg's limits come from the policy file: perp, sz_decimals, max_order_sz, band_bp, max_basis_bp.
leg_args() { python3 -I -c 'import json,sys;p=json.load(open(sys.argv[1]));print(p["perp"],p["sz_decimals"],p["max_order_sz"],p["band_bp"],p["max_basis_bp"])' "$1"; }

case "${1:-}" in
  account)
    [ -n "${FACTORY:-}" ] || put FACTORY "keel-factory-$(openssl rand -hex 3).testnet"
    [ -f "$(key "$FACTORY")" ] || node scripts/keys/gen_near_key.mjs "$FACTORY" "$(key "$FACTORY")" >/dev/null
    pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$FACTORY")")
    "$NEAR" account create-account sponsor-by-faucet-service "$FACTORY" use-manually-provided-public-key "$pk" network-config testnet create > "$OUT/create-factory.txt" 2>&1 || true
    plain "$OUT/create-factory.txt" | grep -E "created|Error" | head -2
    ;;
  deploy)
    "$NEAR" contract deploy "$FACTORY" use-file "$WASM" with-init-call new json-args "{\"mpc\":\"$MPC\",\"sign_domain\":0,\"foreign_tx_domain\":3}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-access-key-file "$(key "$FACTORY")" send > "$OUT/deploy.txt" 2>&1
    plain "$OUT/deploy.txt" | grep -E "Transaction ID|successfully|Error|panicked" | head -3
    echo "factory code: $(code_hash "$FACTORY")  local: $(shasum -a 256 "$WASM" | cut -c1-64)"
    echo "judge code it creates: $(near_view "$FACTORY" judge_code_hash '{}')"
    ;;
  lock)
    pk=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["public_key"])' "$(key "$FACTORY")")
    "$NEAR" account delete-keys "$FACTORY" public-keys "$pk" network-config testnet sign-with-access-key-file "$(key "$FACTORY")" send > "$OUT/lock.txt" 2>&1
    plain "$OUT/lock.txt" | grep -E "Transaction ID|Error" | head -2
    echo "access keys on $FACTORY: $(access_keys "$FACTORY")"
    ;;
  deployers)
    for chain in hyper base; do
      rpc=$([ $chain = hyper ] && echo "$HYPER" || echo "$BASE")
      d=$(cd contracts/evm && forge create src/KeelDeployer.sol:KeelDeployer --rpc-url "$rpc" --keystore ../../.secrets/evm/relayer \
        --password-file ../../.secrets/evm/relayer.password --broadcast | awk '/Deployed to/{print $3}')
      [ -n "$d" ] || { echo "KeelDeployer on $chain failed" >&2; exit 1; }
      put "DEPLOYER_$(echo $chain | tr a-z A-Z)" "$d"; echo "KeelDeployer ($chain): $d"
    done
    ;;
  predict)
    name=${2:?name}; investor=${3:?investor evm address}; policy=${4:-docs/results/g7/ai/policy.json}
    judge="$name.$FACTORY"
    ctrl=$(derive "$judge" keel/1/hyperevm); vctrl=$(derive "$judge" keel/1/spot)
    salt=$(cast keccak "$judge")
    read -r perp szd maxsz band basis <<< "$(leg_args "$policy")"
    leg=$(cast call "$DEPLOYER_HYPER" "predictLeg(bytes32,address,address,uint32,uint8,uint64,uint16,uint16)(address)" "$salt" "$ctrl" "$investor" "$perp" "$szd" "$maxsz" "$band" "$basis" --rpc-url "$HYPER")
    vault=$(cast call "$DEPLOYER_BASE" "predictVault(bytes32,address,address)(address)" "$salt" "$vctrl" "$investor" --rpc-url "$BASE")
    printf 'judge=%s\ncontroller=%s\nvault_controller=%s\nsalt=%s\nleg=%s\nvault=%s\n' "$judge" "$ctrl" "$vctrl" "$salt" "$leg" "$vault"
    ;;
  create)
    name=${2:?name}; policy=${3:?policy json}; investor=${4:?investor evm}; inv_near=${5:?investor near account}; pool=${6:?pool NEAR}; manager=${7:-}
    eval "$("$0" predict "$name" "$investor" "$policy")"
    mkdir -p "$OUT/$name"
    printf 'judge=%s\ncontroller=%s\nvault_controller=%s\nleg=%s\nvault=%s\ninvestor=%s\ninvestor_account=%s\n' "$judge" "$controller" "$vault_controller" "$leg" "$vault" "$investor" "$inv_near" > "$OUT/$name/addresses.txt"
    cfg=$(python3 -I -c '
import json,sys,zlib
p=json.load(open(sys.argv[1])); name,leg,vault,inv,inv_near,mgr=sys.argv[2:8]
p.pop("with_manager",None); sid=int(p.pop("strategy_id",0)) or zlib.crc32(name.encode())
c={"strategy_id":sid,"chain_id":998,"leg":leg,"spot_account":vault,"spot_token":"0x4200000000000000000000000000000000000006",
   "probe":vault,"spot_chain":"base","spot_chain_id":84532,"investor":inv,"investor_account":inv_near,"policy":p}
if mgr: c["manager"]=mgr
print(json.dumps({"name":name,"config":c,"label":name}))' "$policy" "$name" "$leg" "$vault" "$investor" "$inv_near" "$manager")
    echo "$cfg" | python3 -I -m json.tool > "$OUT/$name/create-args.json"
    cost=$(near_view "$FACTORY" creation_cost '{}' | tr -d '"')
    deposit=$(python3 -I -c "print(f'{($cost + int(float(\"$pool\") * 1e24)) / 1e24:.4f} NEAR')")
    echo "creating $judge (storage + a $pool NEAR pool = $deposit), signed by $CREATOR"
    "$NEAR" contract call-function as-transaction "$FACTORY" create_strategy json-args "$cfg" prepaid-gas '200.0 Tgas' attached-deposit "$deposit" \
      sign-as "$CREATOR" network-config testnet sign-with-access-key-file "$(key "$CREATOR")" send > "$OUT/$name/create.txt" 2>&1 || true
    plain "$OUT/$name/create.txt" | grep -E "Transaction ID|panicked|Error" | head -2
    read -r perp szd maxsz band basis <<< "$(leg_args "$policy")"
    echo "KeelLeg:   $(send_tx "$HYPER" "$DEPLOYER_HYPER" "deployLeg(bytes32,address,address,uint32,uint8,uint64,uint16,uint16)" "$salt" "$controller" "$investor" "$perp" "$szd" "$maxsz" "$band" "$basis")"
    echo "KeelVault: $(send_tx "$BASE" "$DEPLOYER_BASE" "deployVault(bytes32,address,address)" "$salt" "$vault_controller" "$investor")"
    "$0" verify "$name"
    ;;
  verify)
    name=${2:?name}; eval "$(cat "$OUT/$name/addresses.txt")"
    ok() { [ "$(echo "$1" | tr A-F a-f)" = "$(echo "$2" | tr A-F a-f)" ] && echo "ok" || echo "MISMATCH ($1 != $2)"; }
    echo "judge $judge: keys $(access_keys "$judge") | code $(code_hash "$judge" | cut -c1-16)… = factory's $(near_view "$FACTORY" judge_code_hash '{}' | tr -d '"' | cut -c1-16)…"
    echo "KeelLeg $leg: controller $(ok "$(cast call "$leg" 'controller()(address)' --rpc-url "$HYPER")" "$controller"), payout $(ok "$(cast call "$leg" 'payout()(address)' --rpc-url "$HYPER")" "$investor")"
    echo "KeelVault $vault: controller $(ok "$(cast call "$vault" 'controller()(address)' --rpc-url "$BASE")" "$vault_controller"), payout $(ok "$(cast call "$vault" 'payout()(address)' --rpc-url "$BASE")" "$investor")"
    near_view "$judge" status '{}' | python3 -I -c 'import json,sys;s=json.load(sys.stdin);print("status:", s["mode"], "| pool %.3f NEAR" % (int(s["pool"])/1e24), "| investor", s["investor_account"])'
    ;;
  list)
    near_view "$FACTORY" list_strategies '{}' | python3 -I -c '
import json,sys
for e in json.load(sys.stdin): print(e["judge"], "|", e["label"], "| by", e["creator"], "| at", e["created_at"])'
    ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
