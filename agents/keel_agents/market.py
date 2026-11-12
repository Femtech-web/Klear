"""Market data for the AI's decisions, from Hyperliquid testnet's public info API.

This is what the AI reads; the judge never trusts it. The judge decides on attested evidence only.
"""
from __future__ import annotations

import time

from .net import post_json

INFO = "https://api.hyperliquid-testnet.xyz/info"


def _post(body: dict):
    return post_json(INFO, body, timeout=20)


def snapshot(coin: str = "ETH", account: str | None = None) -> dict:
    meta, ctxs = _post({"type": "metaAndAssetCtxs"})
    i = [a["name"] for a in meta["universe"]].index(coin)
    ctx = ctxs[i]
    now_ms = int(time.time() * 1000)
    candles = _post({"type": "candleSnapshot", "req": {"coin": coin, "interval": "5m", "startTime": now_ms - 3 * 3600 * 1000, "endTime": now_ms}})
    book = _post({"type": "l2Book", "coin": coin})["levels"]
    out = {
        "coin": coin,
        "mark": float(ctx["markPx"]),
        "oracle": float(ctx["oraclePx"]),
        "funding_hourly": float(ctx["funding"]),
        "open_interest": float(ctx["openInterest"]),
        "day_volume_usd": float(ctx["dayNtlVlm"]),
        "best_bid": [(float(l["px"]), float(l["sz"])) for l in book[0][:3]],
        "best_ask": [(float(l["px"]), float(l["sz"])) for l in book[1][:3]],
        "candles_5m_close": [round(float(c["c"]), 2) for c in candles[-36:]],
    }
    if account:
        st = _post({"type": "clearinghouseState", "user": account})
        pos = [p["position"] for p in st["assetPositions"] if p["position"]["coin"] == coin]
        out["position"] = {"size": float(pos[0]["szi"]), "entry": float(pos[0]["entryPx"]), "unrealized_pnl": float(pos[0]["unrealizedPnl"])} if pos else {"size": 0.0}
        out["account_value_usd"] = float(st["marginSummary"]["accountValue"])
    return out
