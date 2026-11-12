"""Read-only EVM JSON-RPC (HyperEVM and Base testnets): what a guardian without gas or Foundry needs to find
the logs it attests. Nothing here signs or sends a transaction."""
from __future__ import annotations

import time

from .net import post_json

HYPEREVM = "https://rpc.hyperliquid-testnet.xyz/evm"
BASE = "https://sepolia.base.org"

# Log queries go where a public RPC answers wide ranges (sepolia.base.org caps them at 200 blocks, and Base
# Sepolia makes a block every 0.2 s), in chunks of at most this many blocks; the next endpoint is tried when
# one cannot be reached (some resolvers do not resolve publicnode).
LOGS = {
    HYPEREVM: ([HYPEREVM], 1000),
    BASE: (["https://base-sepolia.gateway.tenderly.co", "https://base-sepolia-rpc.publicnode.com"], 20000),
}

SNAPSHOT = "0xf690be071e71e6a54b2373f5f789bad23c206d9294aefa06dd73630a5146ee19"
BALANCE = "0x2bd3e38a1c6aed238c688414f6919db3a3533a99f0c51942438603c49641b8e6"
EXITED = "0xd264510f2a581e9064c1562e54cad0ced0465fc04b03dd1566b8c46edfcca25d"


def rpc(url: str, method: str, params: list):
    for attempt in range(6):
        r = post_json(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" not in r:
            return r["result"]
        if "rate limited" not in str(r["error"]) or attempt == 5:
            raise RuntimeError(f"{method}: {r['error']}")
        time.sleep(5 * (attempt + 1))


def block(url: str, tag: str | int) -> tuple[int, int]:
    """(number, timestamp) of a block by tag ("finalized", "latest") or number."""
    b = rpc(url, "eth_getBlockByNumber", [tag if isinstance(tag, str) else hex(tag), False])
    return int(b["number"], 16), int(b["timestamp"], 16)


def finalized(url: str) -> int:
    return block(url, "finalized")[0]


def logs(url: str, address: str, topic0: str, seconds: int, topics: list | None = None, head: str = "finalized") -> list[dict]:
    """Logs of `address` with `topic0` from the last `seconds` up to `head` (finalized by default), oldest first."""
    to, to_ts = block(url, head)
    back, back_ts = block(url, max(0, to - 1000))
    per_s = (to - back) / max(1, to_ts - back_ts)
    start = max(0, to - int(seconds * per_s) - 1)
    urls, step = LOGS[url]
    out: list[dict] = []
    for a in range(start, to + 1, step):
        params = [{"address": address, "fromBlock": hex(a), "toBlock": hex(min(a + step - 1, to)), "topics": [topic0, *(topics or [])]}]
        for i, log_url in enumerate(urls):
            try:
                out += rpc(log_url, "eth_getLogs", params)
                break
            except (OSError, RuntimeError):
                if i == len(urls) - 1:
                    raise
    return out


def receipt(url: str, tx: str) -> dict | None:
    return rpc(url, "eth_getTransactionReceipt", [tx])
