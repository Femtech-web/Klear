"""The courier: pays the EVM gas a rescue needs, so a guardian with nothing but a NEAR account can run one.

    python3 agents/courier.py [--strategy docs/results/practice] [--for 7200]

It decides nothing and can change nothing. KeelLeg reads its snapshot from HyperCore itself, the vault reads
its own balance, and every order, sweep and exit it relays carries the judge's MPC signature. A courier that
lies, stalls or stops costs a rescue time, never money, and anyone with gas can do its job instead.

While a rescue is due or under way it posts a KeelLeg snapshot every few minutes (a guardian attests one and
opens on it), keeps an attested spot balance fresh, and relays whatever the judge has signed.
"""
from __future__ import annotations

import argparse
import subprocess
import time

from keel_agents import llm
from keel_agents.chain import ROOT, Chain

SNAPSHOT_EVERY = 150
SPOT_EVERY = 25 * 60


def rescue_due(st: dict) -> bool:
    open_modes = ("active", "repairing", "repair-exhausted", "deleveraging")
    return st["mode"] in open_modes and (st["exit_requested"] or (st["silent"] and st["exit_on_silence"]))


class Courier:
    def __init__(self, chain: Chain, signer: str, log):
        self.chain, self.signer, self.log = chain, signer, log
        self.relayed: set[str] = set()
        self.last_snapshot = 0.0
        self.last_spot = 0.0
        self.spot_proc: subprocess.Popen | None = None

    def note(self, kind: str, **fields) -> None:
        llm.note(self.log, "courier", kind, **fields)
        print(f"  courier {kind}: {fields}")

    def tick(self) -> bool:
        """One round; False when there is nothing to carry (no rescue due or under way)."""
        st = self.chain.status()
        if not (rescue_due(st) or st["mode"] == "flattening"):
            return False
        now = time.time()
        if now - self.last_snapshot > SNAPSHOT_EVERY:
            self.note("snapshot", log=self.chain.snapshot(f"c-{int(now)}"))
            self.last_snapshot = now
        self.keep_spot_fresh(now)
        self.relay_signed()
        return True

    def keep_spot_fresh(self, now: float) -> None:
        if self.spot_proc and self.spot_proc.poll() is not None:
            out = (self.spot_proc.stdout.read() if self.spot_proc.stdout else "").strip()
            self.note("spot-attested" if self.spot_proc.returncode == 0 else "spot-failed", out=out.splitlines()[-1:] if out else None)
            self.spot_proc = None
        if self.spot_proc is None and now - self.last_spot > SPOT_EVERY:
            # A vault probe needs Base finality (~20 min) before it can be attested; it runs alongside.
            self.spot_proc = subprocess.Popen(["scripts/testnet/g7.sh", "spot", f"c-{int(now)}-spot", self.signer], cwd=ROOT,
                                              env=self.chain.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.last_spot = now
            self.note("spot-probe")

    def relay_signed(self) -> None:
        s = self.chain.strategy()
        job, r = s.get("job"), s["rescue"]
        todo = []
        if job and job.get("attempt"):
            todo.append(("order", f"{job['id']}:{job['attempt']['order']['nonce']}"))
        if r.get("sweep"):
            todo.append(("sweep", str(r["sweep"]["nonce"])))
        if r.get("exit"):
            todo.append(("exit", str(r["exit"]["nonce"])))
        for kind, key in todo:
            if f"{kind}:{key}" in self.relayed:
                continue
            try:
                tx = {"order": lambda: self.chain.relay_order(key)["tx"], "sweep": lambda: self.chain.relay_sweep(int(key)),
                      "exit": lambda: self.chain.relay_exit(int(key))}[kind]()
                self.note(f"relayed-{kind}", key=key, tx=tx)
            except RuntimeError as e:
                if "no " in str(e):  # not signed yet; the MPC network answers within seconds
                    continue
                # Already relayed by someone else (the nonce is spent) or expired: the judge decides what's next.
                self.note(f"relay-{kind}-refused", key=key, error=str(e)[-200:])
            self.relayed.add(f"{kind}:{key}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", default="docs/results/practice")
    ap.add_argument("--for", dest="seconds", type=float, default=7200)
    ap.add_argument("--interval", type=float, default=30)
    a = ap.parse_args()
    chain = Chain(a.strategy)
    courier = Courier(chain, chain.state["PRACTICE"], chain.out / "courier.jsonl")
    end = time.time() + a.seconds
    while time.time() < end:
        courier.tick()
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
