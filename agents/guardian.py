"""A guardian: watches the strategy and, once the judge reports an exit trigger, runs the rescue.

    python3 agents/guardian.py [--strategy ai] [--ai] [--watch 600] [--interval 60]

Anyone may be a guardian; it has no privileged key. The judge alone decides whether an exit is
triggered (the investor's floor, the investor's request, a silent manager if the investor chose
that), signs every action, and pays each leg's reward only when the investor's address shows it.
With --ai, Claude decides whether to act on a trigger the judge reports (it can decline, never
create one). Without --ai the guardian acts deterministically.
"""
from __future__ import annotations

import argparse
import json
import time

from keel_agents import evm, llm, market
from keel_agents.units import readable
from keel_agents.chain import Chain

SYSTEM = """You are an independent guardian for a Klear strategy (test funds only). An AI manager trades for an
investor under a mandate enforced by a NEAR contract (the judge). You cannot move funds anywhere except the
investor's fixed addresses, and you are paid only after the investor's addresses show the assets arrived.
The judge has verified the trigger below on attested cross-chain evidence. Decide whether to start the rescue
now. Act when the trigger reflects the investor's own choice or a real risk; explain in at most two sentences."""

SCHEMA = {"type": "object", "properties": {"act": {"type": "boolean"}, "reason": {"type": "string"}}, "required": ["act", "reason"]}
RETRY = ("snapshot-not-settled", "attempt-not-resolved", "stale-evidence")


def exited(chain: Chain, nonce: int) -> str | None:
    """The Base transaction that already carried the vault's exit `nonce`, if one did."""
    found = evm.logs(evm.BASE, chain.state["G7_VAULT"], evm.EXITED, 6 * 3600, ["0x" + format(nonce, "064x")], head="latest")
    return found[-1]["transactionHash"] if found else None


class Rescuer:
    def __init__(self, chain: Chain, signer: str, log):
        self.chain, self.signer, self.log = chain, signer, log
        self.exit_txs: dict[int, str] = {}

    def evidence(self) -> tuple[str, str]:
        return self.chain.perp(f"g-{int(time.time())}", self.signer), self.chain.latest_spot()

    def relay(self, out: dict) -> None:
        """Submit everything the judge just signed (signatures arrive a few seconds after the call)."""
        for kind in ("exit", "order", "sweep"):
            plan = out.get(kind)
            if not plan:
                continue
            for attempt in range(10):
                try:
                    if kind == "order":
                        r = self.chain.relay_order(f"{out['job_id']}:{plan['order']['nonce']}")
                    elif kind == "sweep":
                        r = {"tx": self.chain.relay_sweep(plan["sweep"]["nonce"])}
                    else:
                        n = plan["exit"]["nonce"]
                        r = {"tx": self.chain.relay_exit(n)}
                        self.exit_txs[n] = r["tx"]
                    llm.note(self.log, "guardian", f"relayed-{kind}", **r)
                    print(f"    relayed {kind}: {r}")
                    break
                except RuntimeError as e:
                    if "no " not in str(e) or attempt == 9:
                        raise
                    time.sleep(4)

    def step(self, call, what: str) -> dict | None:
        llm.note(self.log, "guardian", what, tx=call.tx, refused=call.error, outcome=call.outcome)
        print(f"  {what}: {call.error or (call.outcome or {}).get('outcome')} ({call.tx})")
        if call.outcome:
            o = call.outcome
            print(f"    perp={o.get('perp')} spot={o.get('spot')} paid={o.get('paid')} done={o.get('done')} ended={o.get('ended')}")
            self.relay(o)
        return call.outcome

    def run(self) -> None:
        s = self.chain.strategy()
        if (s.get("job") or {}).get("agent") == self.signer:
            # Resuming our own job: it is already open; find the vault exit already relayed, if any, and go on.
            r = s["rescue"]
            print(f"  resuming job {s['job']['id']}: perp {r['perp']}, spot {r['spot']}")
            out = {"perp": r["perp"]}
            if r.get("exit") and r["spot"] == "open":
                n = r["exit"]["nonce"]
                self.exit_txs[n] = exited(self.chain, n) or self.chain.relay_exit(n)
        else:
            perp, spot = self.evidence()
            out = self.step(self.chain.open(perp, spot, self.signer), "open")
            if not out:
                return
        while out.get("perp") == "open":
            time.sleep(25)
            perp, spot = self.evidence()
            c = self.chain.settle(perp, spot, self.signer)
            if c.error and any(r in c.error for r in RETRY):
                print(f"  settle: {c.error}, retrying")
                continue
            out = self.step(c, "settle") or out
            if out.get("ended"):
                print("  job ended without finishing; a new job is needed")
                return
        for n, tx in sorted(self.exit_txs.items()):
            print(f"  waiting for Base finality of the vault exit {tx} (~20 min)")
            receipt = self.chain.receipt(tx, self.signer)
            self.step(self.chain.confirm(receipt, self.signer), "confirm-exit")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", default="ai")
    ap.add_argument("--signer", default=None)
    ap.add_argument("--ai", action="store_true")
    ap.add_argument("--watch", type=float, default=0, help="seconds to keep watching for a trigger")
    ap.add_argument("--interval", type=float, default=60)
    a = ap.parse_args()
    chain = Chain(a.strategy)
    signer = a.signer or chain.state.get("G7_GUARDIAN", f"guardian.{chain.judge}")
    log = chain.out / "decisions.jsonl"
    deadline = time.time() + a.watch
    while True:
        perp, spot = chain.perp(f"w-{int(time.time())}", signer), chain.latest_spot()
        view = chain.value(perp, spot)
        s = chain.strategy()
        trig = view.get("trigger")
        print(f"liquidation value {view['valuation']['total_usd6'] / 1e6:.4f} USD (floor {view['valuation']['floor_usd6'] / 1e6}), "
              f"silent={view['silent']}, trigger={trig}, mode={s['mode']}")
        llm.note(log, "guardian", "watch", valuation=view, mode=s["mode"])
        if trig:
            if a.ai:
                prompt = json.dumps({"judge_view": readable(view), "mode": s["mode"], "seconds_since_heartbeat": int(time.time()) - s["last_heartbeat"],
                                     "heartbeat_s": s["config"]["policy"]["heartbeat_s"], "market": market.snapshot("ETH")}, indent=1)
                d = llm.decide("guardian", SYSTEM, prompt, SCHEMA, log)
                print(f"AI guardian: act={d['act']}: {d['reason']}")
                if not d["act"]:
                    # Declining is not giving up: the trigger is re-checked, and the AI asked again.
                    if time.time() >= deadline:
                        return
                    time.sleep(a.interval)
                    continue
            Rescuer(chain, signer, log).run()
            return
        if time.time() >= deadline:
            return
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
