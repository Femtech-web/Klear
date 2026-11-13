"""Chain I/O through scripts/testnet/g7.sh: the agents decide, the runbook acts.

Every call returns what the chain said (transaction id, the judge's outcome or its refusal code);
nothing here interprets or retries on the agent's behalf.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from . import evm
from .net import post_json

ROOT = Path(__file__).resolve().parents[2]
NEAR_RPC = "https://test.rpc.fastnear.com"


@dataclass
class Call:
    tx: str | None
    error: str | None
    outcome: dict | None

    @property
    def ok(self) -> bool:
        return self.tx is not None and self.error is None


def parse_call(out: str) -> Call:
    tx = re.search(r"Transaction ID: ([A-Za-z0-9]+)", out)
    err = re.search(r"Smart contract panicked: (.+)", out)
    js = re.search(r"(\{\"outcome\".*\})", out)
    return Call(tx and tx.group(1), err and err.group(1).strip(), js and json.loads(js.group(1)))


class Chain:
    def __init__(self, strategy: str):
        """`strategy` names a G7 strategy (ai, human) or is the folder of another (docs/results/practice)."""
        self.name = strategy
        if "/" in strategy:
            self.out = ROOT / strategy
            self.env = {**os.environ, "KEEL_DIR": strategy}
        else:
            self.out = ROOT / "docs" / "results" / "g7" / strategy
            self.env = {**os.environ, "G7": strategy}
        state = {}
        for line in (self.out / "env").read_text().splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                state[k] = v
        self.state = state
        self.judge = state["G7_JUDGE"]

    def run(self, *args: str, timeout: int = 3600) -> str:
        p = subprocess.run(["scripts/testnet/g7.sh", *args], cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            raise RuntimeError(f"g7.sh {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
        return p.stdout

    # ---- evidence ----
    def perp(self, tag: str, signer: str) -> str:
        return self.run("perp", tag, signer).strip().splitlines()[-1]

    def snapshot(self, tag: str) -> str:
        """A finalized KeelLeg snapshot, not attested (anyone may attest it); returns the log file."""
        return self.run("snapshot", tag).strip().splitlines()[-1]

    def attest(self, chain: str, log_file: str, signer: str) -> str:
        return self.run("attest", chain, log_file, signer).strip().splitlines()[-1]

    def spot(self, tag: str, signer: str) -> str:
        return self.run("spot", tag, signer).strip().splitlines()[-1]

    def latest_spot(self) -> str:
        return (self.out / "latest-spot").read_text().strip()

    def attested_spot(self, within_s: int) -> tuple[str, int] | None:
        """The newest vault balance anyone attested whose probe is under `within_s` old: (key, probe time)."""
        now = time.time()
        for log in reversed(evm.logs(evm.BASE, self.state["G7_VAULT"], evm.BALANCE, within_s)):
            at = int(log["data"][2 + 64 * 2: 2 + 64 * 3], 16)  # Balance(..., balance, evmBlock, timestamp, tag)
            key = f"base:{log['transactionHash'].lower()}:{int(log['logIndex'], 16)}"
            if now - at < within_s and self.view("get_attested", {"key": key}) is not None:
                return key, at
        return None

    def receipt(self, exit_tx: str, signer: str) -> str:
        return self.run("receipt", exit_tx, signer).strip().splitlines()[-1]

    # ---- judge calls ----
    def propose(self, perp: str, spot: str, side: str, sz: int, px: int, sealed: dict | None = None) -> Call:
        extra = [json.dumps(sealed, separators=(",", ":"))] if sealed else []
        return parse_call(self.run("propose", perp, spot, side, str(sz), str(px), *extra))

    def heartbeat(self, sealed: dict | None = None) -> Call:
        return parse_call(self.run("heartbeat", *([json.dumps(sealed, separators=(",", ":"))] if sealed else [])))

    def rearm(self) -> Call:
        return parse_call(self.run("rearm"))

    def fund_pool(self, near: float, signer: str) -> Call:
        return parse_call(self.run("fund-pool", str(near), signer))

    def open(self, perp: str, spot: str, signer: str) -> Call:
        return parse_call(self.run("open", perp, spot, signer))

    def delever(self, perp: str, spot: str, signer: str) -> Call:
        return parse_call(self.run("delever", perp, spot, signer))

    def settle(self, perp: str, spot: str, signer: str) -> Call:
        return parse_call(self.run("settle", perp, spot, signer))

    def confirm(self, receipt: str, signer: str) -> Call:
        return parse_call(self.run("confirm", receipt, signer))

    # ---- relaying what the judge signed (anyone may) ----
    def relay_order(self, key: str) -> dict:
        out = self.run("relay-order", key)
        js = [l for l in out.splitlines() if l.startswith("{")]
        sent = re.search(r"relayed (0x[0-9a-f]+)", out)
        if not sent:
            raise RuntimeError(f"relay-order {key}: {out.strip()[-240:]}")
        return {"tx": sent.group(1), "fill": json.loads(js[-1]) if js else None}

    def relay_sweep(self, nonce: int) -> str:
        return re.search(r"(0x[0-9a-f]{64})", self.run("relay-sweep", str(nonce))).group(1)

    def relay_exit(self, nonce: int) -> str:
        return re.search(r"(0x[0-9a-f]{64})", self.run("relay-exit", str(nonce))).group(1)

    # ---- views ----
    def view(self, method: str, args: dict | None = None):
        body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
            "request_type": "call_function", "finality": "final", "account_id": self.judge, "method_name": method,
            "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()}}
        r = post_json(NEAR_RPC, body)
        if "result" not in r or "result" not in r["result"]:
            raise RuntimeError(f"view {method}: {json.dumps(r)[:300]}")
        return json.loads(bytes(r["result"]["result"]))

    def strategy(self) -> dict:
        return self.view("get_strategy")

    def status(self) -> dict:
        return self.view("status")

    def value(self, perp: str, spot: str) -> dict:
        return self.view("valuation", {"perp": perp, "spot": spot})
