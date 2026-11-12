"""Fetch the real trading history of Alpha Arena's AI agents from Hyperliquid's public mainnet API.

    .tools/venv/bin/python scripts/replay/fetch.py [address ...]

For each wallet in fixtures/replay/wallets.json: the deposit/withdrawal ledger, every fill, every funding
payment, and Hyperliquid's own (coarse) account-value history, cached unmodified (gzipped) in
fixtures/replay/raw/<address>.json.gz. Read-only; no key involved.
"""
from __future__ import annotations

import gzip
import json
import ssl
import sys
import time
import urllib.request
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parents[2]
API = "https://api.hyperliquid.xyz/info"
CTX = ssl.create_default_context(cafile=certifi.where())


def info(body: dict):
    for attempt in range(5):
        try:
            req = urllib.request.Request(API, json.dumps(body).encode(), {"content-type": "application/json", "user-agent": "keel-replay/0.1"})
            return json.load(urllib.request.urlopen(req, timeout=30, context=CTX))
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            time.sleep(2 ** attempt)


def paged(kind: str, user: str, start: int, key=lambda x: x["time"]) -> list:
    """Hyperliquid returns time-ordered pages from `startTime`; walk forward until a short page."""
    out, t = [], start
    while True:
        page = info({"type": kind, "user": user, "startTime": t})
        out += page
        if len(page) < 500:
            break
        t = key(page[-1]) + 1
        time.sleep(0.3)
    seen, uniq = set(), []
    for x in out:
        k = json.dumps(x, sort_keys=True)
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq


def main() -> None:
    wallets = json.loads((ROOT / "fixtures/replay/wallets.json").read_text())["wallets"]
    only = {a.lower() for a in sys.argv[1:]}
    for w in wallets:
        a = w["address"]
        if only and a not in only:
            continue
        raw = {
            "wallet": w,
            "fetched_at": int(time.time()),
            "ledger": info({"type": "userNonFundingLedgerUpdates", "user": a, "startTime": 0}),
            "fills": paged("userFillsByTime", a, 0),
            "funding": paged("userFunding", a, 0),
            "portfolio_all_time": dict(info({"type": "portfolio", "user": a}))["allTime"]["accountValueHistory"],
        }
        (ROOT / f"fixtures/replay/raw/{a}.json.gz").write_bytes(gzip.compress(json.dumps(raw).encode(), mtime=0))
        print(f"{w['model']:22} {w['competition']:26} fills {len(raw['fills']):5}  funding {len(raw['funding']):5}  ledger {len(raw['ledger']):3}")
        time.sleep(0.5)


if __name__ == "__main__":
    main()
