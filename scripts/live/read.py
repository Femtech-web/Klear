#!/usr/bin/env python3
"""Read-only check: KeelLeg's own read path, run inside eth_call on HyperEVM testnet against the
real precompiles, compared with Hyperliquid's info API. Sends no transaction, needs no key."""
import json, subprocess, sys, time, datetime

RPC = "https://rpc.hyperliquid-testnet.xyz/evm"
API = "https://api.hyperliquid-testnet.xyz/info"
PERP, SZD = 4, 4

def sh(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout.strip()

def info(body):
    return json.loads(sh("curl", "-s", "-X", "POST", API, "-H", "content-type: application/json", "-d", json.dumps(body)))

def main(out_path):
    meta, ctxs = info({"type": "metaAndAssetCtxs"})
    assert meta["universe"][PERP]["name"] == "ETH" and meta["universe"][PERP]["szDecimals"] == SZD
    # Accounts with an open ETH position, from recent public trades.
    trades = info({"type": "recentTrades", "coin": "ETH"})
    users = []
    for t in trades:
        for u in t.get("users", []):
            if u not in users:
                users.append(u)
    users = users[:6]
    code = json.load(open("contracts/evm/out/LiveRead.sol/LiveRead.json"))["bytecode"]["object"]
    args = sh("cast", "abi-encode", "f(address[],uint32,uint8)", "[" + ",".join(users) + "]", str(PERP), str(SZD))
    t0 = time.time()
    raw = sh("cast", "call", "--rpc-url", RPC, "--create", code + args[2:])
    api = {u: info({"type": "clearinghouseState", "user": u}) for u in users}
    t1 = time.time()
    dec = json.loads(sh("cast", "abi-decode", "--json", "f()(int64[],uint64[],uint64,uint64,uint64,uint256)", raw))
    szi = [int(x) for x in dec[0]]
    ntl = [int(x) for x in dec[1]]
    rows = []
    for i, u in enumerate(users):
        pos = next((p["position"] for p in api[u]["assetPositions"] if p["position"]["coin"] == "ETH"), None)
        api_szi = pos["szi"] if pos else "0"
        rows.append({
            "user": u,
            "keelleg_szi": szi[i] / 10**SZD,
            "keelleg_entryNtl_usd": int(ntl[i]) / 1e6,
            "api_szi": api_szi,
            "api_entry_x_size": round(float(pos["entryPx"]) * abs(float(pos["szi"])), 2) if pos else 0,
            "szi_match": abs(szi[i] / 10**SZD - float(api_szi)) < 1e-9,
        })
    oracle_raw = int(dec[2])
    result = {
        "kind": "read-only eth_call on HyperEVM testnet (no transaction)",
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "rpc": RPC,
        "evm_block": int(dec[5]),
        "l1_block": int(dec[4]),
        "oracle_raw": oracle_raw,
        "oracle1e8": int(dec[3]),
        "api_oracle": ctxs[PERP]["oraclePx"],
        "oracle_match": abs(oracle_raw / 10 ** (6 - SZD) - float(ctxs[PERP]["oraclePx"])) < 0.5,
        "seconds_between_reads": round(t1 - t0, 2),
        "rows": rows,
    }
    json.dump(result, open(out_path, "w"), indent=2)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    day = datetime.date.today().isoformat()
    main(sys.argv[1] if len(sys.argv) > 1 else f"docs/results/live-read-{day}.json")
