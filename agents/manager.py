"""The AI manager: reads the market, asks Claude for one decision, and proposes it to the judge.

    python3 agents/manager.py [--strategy ai] [--cycles 3] [--interval 60]
    python3 agents/manager.py --strategy docs/results/delever --sealed --strategy-file .secrets/strategy.md

With --sealed the decision is made by a model in a TEE on NEAR AI Cloud, end-to-end encrypted, and verified
against the hardware's attestation (keel_agents/sealed.py). The investor's strategy (--strategy-file) is read
only by that TEE; the order carries the TEE's signed receipt on chain, and the judge bounds it as any other.

It signs with a NEAR function-call key that can call only `propose_order` and `heartbeat` on the judge;
it never holds a key that can move funds. The judge signs an order only if it fits the investor's
mandate on attested state, and anyone (here, the operator's relayer) submits what the judge signed.
Stopping this process is how the demo simulates a manager outage: the heartbeats stop.
"""
from __future__ import annotations

import argparse
import json
import time

from pathlib import Path

from keel_agents import llm, market
from keel_agents.chain import ROOT, Chain
from keel_agents.px import lots, valid_limit
from keel_agents.units import readable

DATA_RELAYER = "agent.keel-8f2f34.testnet"  # attests evidence; holds no role in the mandate

SYSTEM = """You are the AI portfolio manager of a Klear strategy on Hyperliquid testnet (test funds only).
You manage one ETH perpetual position for an investor, who also holds ETH (as WETH on Base) in the
same strategy. A NEAR smart contract (the judge) enforces the investor's mandate and signs your order
only if it fits: one immediate-or-cancel limit order at a time, at most {max_order} ETH per order, a
limit within {band}% of the mark, leverage (|perp notional| / liquidation value) at most {lev}x after
the order, and no trading while the liquidation value is below the floor of {floor} USD. Hyperliquid
rejects orders under 10 USD notional. You cannot withdraw or move funds. Decide one order or hold.
Explain your reasoning in at most two sentences."""

SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["buy", "sell", "hold"]},
        "size_eth": {"type": "number", "minimum": 0},
        "limit_price": {"type": "number", "minimum": 0},
        "reason": {"type": "string"},
    },
    "required": ["action", "size_eth", "limit_price", "reason"],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", default="ai")
    ap.add_argument("--cycles", type=int, default=1)
    ap.add_argument("--interval", type=float, default=60)
    ap.add_argument("--sealed", action="store_true", help="decide in a TEE on NEAR AI Cloud, end-to-end encrypted")
    ap.add_argument("--strategy-file", type=Path, help="the investor's private strategy, read only by the sealed model")
    a = ap.parse_args()
    chain = Chain(a.strategy)
    log = chain.out / "decisions.jsonl"
    p = chain.strategy()["config"]["policy"]
    system = SYSTEM.format(max_order=p["max_order_sz"] / 1e8, band=p["band_bp"] / 100, lev=p["max_leverage_bp"] / 1e4, floor=p["equity_floor_usd6"] / 1e6)
    if a.strategy_file:
        system += "\n\nThe investor's strategy, which you follow within the mandate:\n" + a.strategy_file.read_text()
    private = ROOT / ".secrets" / "sealed" / f"{chain.judge}.jsonl"  # git-ignored: the strategy and the AI's reasoning

    for i in range(a.cycles):
        hb = chain.heartbeat()
        llm.note(log, "manager", "heartbeat", tx=hb.tx, error=hb.error)
        perp = chain.perp(f"mgr-{int(time.time())}", DATA_RELAYER)
        spot = chain.latest_spot()
        view = chain.value(perp, spot)
        mkt = market.snapshot("ETH", chain.state["G7_LEG"])
        prompt = json.dumps({"market": mkt, "judge_valuation": readable(view)}, indent=1)
        receipt = None
        if a.sealed:
            from keel_agents import sealed  # needs agents/requirements-sealed.txt
            d, receipt = sealed.decide("manager", system, prompt, SCHEMA, log, private)
            print(f"    sealed: {receipt['model']} in a TEE (TDX {receipt['tdx']}, GPU {receipt['gpu']}), signer {receipt['signer']['key'][:16]}…")
        else:
            d = llm.decide("manager", system, prompt, SCHEMA, log)
        print(f"[{i}] AI: {d['action']} {d['size_eth']} @ {d['limit_price']}: {d['reason']}")
        if d["action"] == "hold":
            llm.note(log, "manager", "held")
        else:
            is_buy = d["action"] == "buy"
            sz, px = lots(d["size_eth"]), valid_limit(d["limit_price"], is_buy)
            c = chain.propose(perp, spot, d["action"], sz, px, sealed=receipt)
            llm.note(log, "manager", "judge-verdict", proposal={"side": d["action"], "sz": sz, "limit_px": px}, tx=c.tx, refused=c.error, outcome=c.outcome)
            print(f"    judge: {c.error or c.outcome['outcome']} ({c.tx})")
            if c.ok and c.outcome and c.outcome["outcome"] == "sign":
                time.sleep(4)
                r = chain.relay_order(f"0:{c.outcome['order']['nonce']}")
                llm.note(log, "relayer", "relayed", **r)
                print(f"    relayed {r['tx']}: {r['fill']}")
        if i + 1 < a.cycles:
            time.sleep(a.interval)


if __name__ == "__main__":
    main()
