"""The daily drill: the practice strategy fails on purpose and is rescued, every step a real transaction.

    python3 agents/drill.py [--grace 0] [--usdc 4.9] [--weth-wei 4000000000000000] [--size 0.006]

1. Re-arm: if the last cycle ended in a rescue, the investor starts the next one (same mandate, same accounts).
2. Fund: the relayer tops both legs up. It is also the practice payout, so every rescue pays it back.
3. Trade: the manager (deterministic here, signing with its function-call key) opens a small short and then
   goes silent. The investor's mandate says a manager silent for heartbeat_s means exit.
4. Rescue: once the judge reports the manager silent, anyone may rescue for --grace seconds (docs/practice.md),
   with the courier paying their EVM gas (agents/courier.py); after that the drill's own guardian does: close,
   sweep, vault exit, each leg paid only on delivery.
5. Record: the cycle's steps and the judge's state after it go to docs/results/drill/.
A refused or failed step ends the drill and is recorded as the cycle's failure; nothing is retried blindly.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time

from courier import Courier
from guardian import Rescuer
from keel_agents import llm, market
from keel_agents.chain import ROOT, Call, Chain
from keel_agents.net import post_json
from keel_agents.px import lots, valid_limit

STRATEGY = "docs/results/practice"
OUT = ROOT / "docs" / "results" / "drill"
NEAR_RPC = "https://test.rpc.fastnear.com"
HEARTBEAT_EVERY = 300
YOCTO = 10**24


class Failed(Exception):
    pass


def last_line(text: str) -> str:
    """A subprocess's failure, as its last non-empty line (a traceback ends with the error itself)."""
    lines = [l.strip() for l in (text or "").strip().splitlines() if l.strip()]
    return lines[-1][-300:] if lines else "no output"


def near_balance(account: str) -> int:
    r = post_json(NEAR_RPC, {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "view_account", "finality": "final", "account_id": account}})
    return int(r["result"]["amount"])


def allowance(account: str, key_file: str) -> int:
    pk = json.loads((ROOT / ".secrets" / "near" / f"{key_file}.json").read_text())["public_key"]
    r = post_json(NEAR_RPC, {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "view_access_key", "finality": "final", "account_id": account, "public_key": pk}})
    return int(r["result"]["permission"]["FunctionCall"]["allowance"] or 0)


class Drill:
    def __init__(self, a: argparse.Namespace):
        self.a = a
        self.chain = Chain(STRATEGY)
        st = self.chain.state
        self.ops = st["PRACTICE"]  # pays for evidence and top-ups; holds no role in the mandate
        self.guardian = st["G7_GUARDIAN"]
        self.started = int(time.time())
        OUT.mkdir(parents=True, exist_ok=True)
        self.log = OUT / f"cycle-{self.started}.jsonl"
        self.steps: list[dict] = []

    def note(self, name: str, **fields) -> None:
        llm.note(self.log, "drill", name, **fields)
        self.steps.append({"at": int(time.time()), "step": name, **fields})
        print(f"[{time.strftime('%H:%M:%S')}] {name}: {json.dumps(fields)[:300]}")

    def call(self, name: str, c: Call) -> Call:
        self.note(name, tx=c.tx, refused=c.error, outcome=c.outcome)
        if not c.ok:
            raise Failed(f"{name}: {c.error or 'no transaction'}")
        return c

    def sh(self, *args: str) -> str:
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=1800)
        if p.returncode != 0:
            raise Failed(f"{args[0]} {args[1]}: {last_line(p.stderr or p.stdout)}")
        return p.stdout.strip()

    def heartbeat(self) -> None:
        self.call("heartbeat", self.chain.heartbeat())
        self.last_beat = time.time()

    def alive_while(self, proc: subprocess.Popen) -> str:
        """The manager keeps heartbeating while it waits on something slow (Base finality)."""
        while proc.poll() is None:
            if time.time() - self.last_beat > HEARTBEAT_EVERY:
                self.heartbeat()
            time.sleep(10)
        out, err = proc.communicate()
        if proc.returncode != 0:
            raise Failed(f"spot evidence: {last_line(err or out)}")
        return out.strip().splitlines()[-1]

    # ---- the cycle ----
    def prepare(self) -> dict:
        st = self.chain.status()
        if st["mode"] == "flattened":
            self.call("rearm", self.chain.rearm())
            st = self.chain.status()
        if st["mode"] != "active" or st["job"]:
            raise Failed(f"not ready: mode {st['mode']}, job {st['job']}")
        self.cycle = st["cycle"]
        self.paid_before = len(self.chain.strategy()["payouts"])
        self.last_beat = 0.0
        self.heartbeat()
        p = self.chain.strategy()["config"]["policy"]
        if int(st["pool"]) < int(p["flatten_reward"]) + int(p["spot_reward"]):
            payer = self.guardian if near_balance(self.guardian) > 2 * YOCTO else self.ops
            self.call("fund-pool", self.chain.fund_pool(1.0, payer))
        if allowance(st["manager"], self.chain.state["G7_MANAGER_KEY"]) < YOCTO // 20:
            self.note("manager-key", out=self.sh("scripts/testnet/practice.sh", "manager-key"))
        # Funding tops up to a target, so repeating it is safe; a dropped connection gets two more tries.
        for attempt in range(3):
            try:
                self.note("fund", out=self.sh("scripts/testnet/practice.sh", "fund", str(self.a.usdc), str(self.a.weth_wei)))
                break
            except Failed as e:
                if attempt == 2:
                    raise
                self.note("fund-retry", error=str(e))
                time.sleep(20)
        return p

    def trade(self, p: dict) -> None:
        # An attested vault balance young enough to last the cycle is reused; otherwise probe and wait for Base.
        fresh = self.chain.attested_spot(p["max_evidence_age_s"] - 1800)
        if fresh:
            self.spot, self.spot_at = fresh
            self.note("spot-reused", evidence=self.spot, age_s=int(time.time()) - self.spot_at)
        else:
            proc = subprocess.Popen(["scripts/testnet/g7.sh", "spot", f"d{self.started}-spot", self.ops], cwd=ROOT,
                                    env=self.chain.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.note("spot-probe", waiting="Base finality, about 25 minutes")
            self.spot = self.alive_while(proc)
            self.spot_at = time.time() - 1500
            self.note("spot-attested", evidence=self.spot)
        (self.chain.out / "latest-spot").write_text(self.spot + "\n")
        for attempt in range(2):
            perp = self.chain.perp(f"d{self.started}-m{attempt}", self.ops)
            m = market.snapshot("ETH")
            # An IOC sell fills only at or under the best bid; the judge allows 1% around the mark (testnet's
            # mark often sits above the book). Sell through the bid, inside the band.
            px = valid_limit(max(min(m["best_bid"][0][0] * 0.999, m["mark"] * 0.996), m["mark"] * 0.992), False)
            c = self.call("open-short", self.chain.propose(perp, self.spot, "sell", lots(self.a.size), px))
            if c.outcome["outcome"] != "sign":
                raise Failed(f"open-short: {c.outcome}")
            time.sleep(4)
            r = self.chain.relay_order(f"0:{c.outcome['order']['nonce']}")
            self.note("relayed-short", **r)
            if r.get("fill") and not r["fill"].get("timeout"):
                break
            self.heartbeat()
        self.note("manager-silent", last_heartbeat=self.chain.status()["last_heartbeat"])
        # Fresh spot evidence for the rescue: Base finality runs during the manager's silence.
        self.refresh_at = time.time()
        self.refresh = subprocess.Popen(["scripts/testnet/g7.sh", "spot", f"d{self.started}-g", self.ops], cwd=ROOT,
                                        env=self.chain.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def rescue(self, p: dict) -> str:
        """Waits for the trigger and the grace window; returns who rescued."""
        while not self.chain.status()["silent"]:
            time.sleep(30)
        due = time.time()
        self.note("rescue-due", reason="manager silent", grace_s=self.a.grace)
        self.courier = Courier(self.chain, self.ops, self.log)
        self.courier.last_spot = self.refresh_at  # the rescue's own probe counts as the courier's
        while time.time() - due < self.a.grace:
            self.courier.tick()
            st = self.chain.status()
            if st["job"] and st["job"]["agent"] != self.guardian:
                return self.watch_visitor(st["job"]["agent"])
            time.sleep(30)
        self.rescue_spot(p)
        Rescuer(self.chain, self.guardian, self.log).run()
        return self.guardian

    def rescue_spot(self, p: dict) -> None:
        """Spot evidence for the rescue: the probe started when the manager fell silent, or (resuming) any
        attested balance young enough, or a new probe."""
        refresh = getattr(self, "refresh", None)
        if refresh:
            out, err = refresh.communicate()
            if refresh.returncode == 0:
                self.note("spot-attested", evidence=out.strip().splitlines()[-1])
                return
            self.note("spot-check-failed", error=last_line(err or out))
        found = self.chain.attested_spot(p["max_evidence_age_s"] - 900)
        if found:
            # The probe may have been attested even if reading it back failed.
            self.spot = found[0]
            (self.chain.out / "latest-spot").write_text(self.spot + "\n")
            self.note("spot-reused", evidence=self.spot, age_s=int(time.time()) - found[1])
            return
        self.note("spot-attested", evidence=self.chain.spot(f"d{self.started}-r", self.ops))

    def watch_visitor(self, agent: str) -> str:
        self.note("visitor-rescue", agent=agent)
        while self.chain.status()["mode"] != "flattened":
            self.courier.tick()
            st = self.chain.status()
            if not st["job"] and st["mode"] == "active":
                raise Failed(f"the rescue by {agent} ended unfinished")
            time.sleep(30)
        return agent

    def record(self, ok: bool, rescuer: str | None, error: str | None) -> None:
        # A failure is recorded even when the chain cannot be read right now.
        try:
            s, st = self.chain.strategy(), self.chain.status()
        except Exception as e:  # noqa: BLE001
            s, st = {"payouts": [], "rescue": {"deliveries": []}}, {"mode": None, "trigger": None}
            error = f"{error}; final state unreadable: {e}" if error else f"final state unreadable: {e}"
        rec = {
            "cycle": getattr(self, "cycle", None), "judge": self.chain.judge, "started": self.started, "ended": int(time.time()),
            "ok": ok, "error": error, "rescuer": rescuer, "mode": st["mode"], "trigger": st["trigger"],
            "payouts": s["payouts"][getattr(self, "paid_before", len(s["payouts"])):],
            "deliveries": [d for d in s["rescue"]["deliveries"] if d.get("cycle") == getattr(self, "cycle", -1)],
            "steps": self.steps, "log": self.log.name,
        }
        with (OUT / "runs.jsonl").open("a") as f:
            f.write(json.dumps(rec) + "\n")
        (OUT / "latest.json").write_text(json.dumps(rec, indent=1) + "\n")
        print(f"cycle {rec['cycle']}: {'rescued by ' + rescuer if ok else 'FAILED: ' + str(error)}")

    def run(self) -> bool:
        rescuer = None
        try:
            st = self.chain.status()
            if st["mode"] == "active" and not st["job"] and (st["silent"] and st["exit_on_silence"] or st["exit_requested"]):
                # A cycle cut short after its trigger: finish its rescue instead of starting another.
                self.cycle, self.paid_before = st["cycle"], len(self.chain.strategy()["payouts"])
                self.refresh_at = time.time()
                self.note("resume", reason="the rescue is already due")
                p = self.chain.strategy()["config"]["policy"]
            else:
                p = self.prepare()
                self.trade(p)
            rescuer = self.rescue(p)
            if self.chain.status()["mode"] != "flattened":
                raise Failed(f"rescue ended in mode {self.chain.status()['mode']}")
        except Exception as e:  # noqa: BLE001  every failure ends the cycle and is recorded
            self.note("failed", error=str(e))
            self.record(False, rescuer, str(e))
            return False
        self.record(True, rescuer, None)
        return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grace", type=float, default=0, help="seconds a rescue stays open to anyone before the drill's guardian acts")
    ap.add_argument("--usdc", type=float, default=4.9)
    ap.add_argument("--weth-wei", type=int, default=4 * 10**15)
    ap.add_argument("--size", type=float, default=0.006, help="ETH; Hyperliquid's minimum order is 10 USD")
    raise SystemExit(0 if Drill(ap.parse_args()).run() else 1)


if __name__ == "__main__":
    main()
