"""One live deleverage: Klear's early risk cut, before the floor, on a strategy created through the factory.

    python3 agents/delever_demo.py

The strategy (`delever.keel-factory-bcf915.testnet`) has a warning level of $15 above a $3 floor and a target of
0.2x. Funded with less than $15, it is in early warning as soon as it holds a position:
1. fund the KeelLeg and the vault; attest the vault's balance (Base finality, about 25 minutes);
2. the manager buys 0.01 ETH, within its 2x cap;
3. a guardian opens the deleverage; the judge plans a reduce-only sell down to 0.2x of the liquidation value;
4. the order is relayed; the guardian settles until the judge sees the position at the target and pays it.
Every step is a real transaction, recorded in docs/results/delever/run.jsonl. Run again to resume: with the
position already open it goes straight to the guardian.
"""
from __future__ import annotations

import json
import subprocess
import time

from keel_agents import llm, market
from keel_agents.chain import ROOT, Call, Chain
from keel_agents.net import post_json
from keel_agents.px import lots, valid_limit

STRATEGY = "docs/results/delever"
RETRY = ("attempt-not-resolved", "snapshot-not-settled", "stale-evidence")


class Failed(Exception):
    pass


def position(leg: str) -> float:
    for i in range(8):  # a DNS outage outlasts post_json's own retries on a flaky network
        try:
            st = post_json("https://api.hyperliquid-testnet.xyz/info", {"type": "clearinghouseState", "user": leg})
            break
        except OSError:
            if i == 7:
                raise
            time.sleep(15)
    p = [x["position"] for x in st["assetPositions"] if x["position"]["coin"] == "ETH"]
    return float(p[0]["szi"]) if p else 0.0


def main() -> None:
    chain = Chain(STRATEGY)
    st = chain.state
    ops, guardian, leg = st["PRACTICE"], st["G7_GUARDIAN"], st["G7_LEG"]
    log = chain.out / "run.jsonl"

    def note(kind: str, **f) -> None:
        llm.note(log, "delever", kind, **f)
        print(f"[{time.strftime('%H:%M:%S')}] {kind}: {json.dumps(f)[:240]}", flush=True)

    def ok(kind: str, c: Call) -> dict:
        note(kind, tx=c.tx, refused=c.error, outcome=c.outcome)
        if not c.ok:
            raise Failed(f"{kind}: {c.error or 'no transaction'}")
        return c.outcome or {}

    def retry(f, what: str, n: int = 4):
        for i in range(n):
            try:
                return f()
            except (RuntimeError, OSError, subprocess.SubprocessError) as e:
                if i == n - 1:
                    raise
                note(f"{what}-retry", error=str(e)[-200:])
                time.sleep(20)

    def until_settled(kind: str, call, tries: int, wait: int) -> dict:
        """A fresh guardian snapshot each try, until the judge no longer answers 'not yet'."""
        for _ in range(tries):
            time.sleep(wait)
            perp = retry(lambda: chain.perp(f"dl-g-{int(time.time())}", guardian), "perp")
            c = call(perp)
            if not (c.error and any(r in c.error for r in RETRY)):
                return ok(kind, c)
            note(f"{kind}-not-yet", tx=c.tx, refused=c.error)
        raise Failed(f"{kind}: still not settled after {tries} tries")

    def manager(spot: str) -> None:
        # One buy of 0.01 ETH through the ask, inside the judge's 1% band.
        ok("heartbeat", chain.heartbeat())
        perp = retry(lambda: chain.perp(f"dl-m-{int(time.time())}", ops), "perp")
        m = market.snapshot("ETH")
        px = valid_limit(min(m["mark"] * 1.009, m["best_ask"][0][0] * 1.002), True)
        sig = ok("manager-buys", chain.propose(perp, spot, "buy", lots(0.01), px))
        if sig.get("outcome") != "sign":
            raise Failed(f"the judge did not sign the manager's order: {sig}")
        time.sleep(4)
        note("relayed-buy", **retry(lambda: chain.relay_order(f"0:{sig['order']['nonce']}"), "relay"))
        for _ in range(20):
            if position(leg) > 0:
                break
            time.sleep(6)
        note("position", eth=position(leg))
        if position(leg) <= 0:
            raise Failed("the manager's buy did not fill")

    held = position(leg)
    if not held:
        env = {**chain.env, "KEEL_STRATEGY": "delever"}
        out = retry(lambda: subprocess.run(["scripts/testnet/practice.sh", "fund", "3.9", str(4 * 10**15)], cwd=ROOT, env=env,
                                           capture_output=True, text=True, check=True).stdout.strip(), "fund")
        note("fund", out=out)
    found = chain.attested_spot(1800)
    spot = found[0] if found else retry(lambda: chain.spot(f"dl-{int(time.time())}", ops), "spot")
    note("spot-attested", evidence=spot)
    if held:
        note("resume", eth=held)
    else:
        manager(spot)

    # A guardian: the deleverage, on evidence it attested itself, once the manager's order has settled.
    out = until_settled("open-deleverage", lambda p: chain.delever(p, spot, guardian), 6, 20)
    while out.get("outcome") == "sign":
        job, nonce = out["job_id"], out["order"]["nonce"]
        time.sleep(4)
        note("relayed-cut", **retry(lambda: chain.relay_order(f"{job}:{nonce}"), "relay"))
        note("position", eth=position(leg))
        out = until_settled("settle", lambda p: chain.settle(p, spot, guardian), 30, 30)
    note("done", outcome=out, eth=position(leg))


if __name__ == "__main__":
    main()
