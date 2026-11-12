"""Rescue the practice strategy yourself, with nothing but a NEAR testnet account.

    python3 agents/rescue.py --account you.testnet [--key path/to/you.testnet.json] [--wait]

When the practice strategy's manager goes silent (docs/practice.md has the daily window), the judge lets
anyone rescue it. This runs the same rescue as Keel's own guardian, signed by your account: you attest
the evidence, open the rescue, settle it, and confirm the vault's exit. The judge pays your account for
each leg it sees delivered to the investor. The courier pays the EVM gas (snapshots and relaying what the
judge signed); it cannot change anything you or the judge decide.

Your key never leaves this machine: NEAR's CLI signs locally with the key file you point at.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

from courier import rescue_due
from guardian import Rescuer
from keel_agents import evm
from keel_agents.chain import ROOT, Chain
from keel_agents.net import post_json

STRATEGY = "docs/results/practice"
WORK = ROOT / ".keel-visitor"


def evidence_key(chain: str, log: dict) -> str:
    return f"{chain}:{log['transactionHash'].lower()}:{int(log['logIndex'], 16)}"


def word(log: dict, i: int) -> int:
    return int(log["data"][2 + 64 * i: 2 + 64 * (i + 1)], 16)


class VisitorChain(Chain):
    """A guardian without EVM gas: it finds the logs the courier posts and waits for its relays."""

    def __init__(self, account: str, key_file: Path):
        super().__init__(STRATEGY)
        self.out = WORK / self.judge
        (self.out / "keys").mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / STRATEGY / "env", self.out / "env")
        link = self.out / "keys" / f"{account}.json"
        link.unlink(missing_ok=True)
        link.symlink_to(key_file.resolve())
        self.env = {**os.environ, "KEEL_DIR": str(self.out.relative_to(ROOT)), "KEEL_KEYS": str(self.out / "keys")}

    def attested(self, key: str) -> bool:
        return self.view("get_attested", {"key": key}) is not None

    def perp(self, tag: str, signer: str) -> str:
        """The newest snapshot under 200 s old that nobody has attested yet, attested by you."""
        for _ in range(30):
            now = time.time()
            for log in reversed(evm.logs(evm.HYPEREVM, self.state["G7_LEG"], evm.SNAPSHOT, 600)):
                if now - word(log, 12) > 200:
                    break
                if not self.attested(evidence_key("hyperevm", log)):
                    path = self.out / f"{tag}-perp-log.json"
                    path.write_text(json.dumps(log))
                    return self.attest("hyperevm", str(path), signer)
            print("    waiting for the courier's next snapshot")
            time.sleep(20)
        raise RuntimeError("no fresh KeelLeg snapshot for 10 minutes: is the courier running? (docs/practice.md)")

    def latest_spot(self) -> str:
        """The newest vault balance someone attested in the last hour (anyone may attest the spot leg)."""
        found = self.attested_spot(3600)
        if not found:
            raise RuntimeError("no attested vault balance in the last hour: the courier attests one every 25 minutes")
        return found[0]

    def relay_order(self, key: str) -> dict:
        return {"tx": None, "by": "the courier"}

    def relay_sweep(self, nonce: int) -> str:
        return "the courier"

    def relay_exit(self, nonce: int) -> str:
        topic = "0x" + format(nonce, "064x")
        for _ in range(60):
            found = evm.logs(evm.BASE, self.state["G7_VAULT"], evm.EXITED, 3600, [topic], head="latest")
            if found:
                return found[-1]["transactionHash"]
            print("    waiting for the courier to relay the vault exit")
            time.sleep(15)
        raise RuntimeError(f"the vault exit {nonce} was not relayed within 15 minutes")

    def receipt(self, exit_tx: str, signer: str) -> str:
        r = evm.receipt(evm.BASE, exit_tx)
        while evm.finalized(evm.BASE) < int(r["blockNumber"], 16):
            time.sleep(20)
        log = [l for l in r["logs"] if l["address"].lower() == self.state["G7_VAULT"].lower() and l["topics"][0] == evm.EXITED][-1]
        path = self.out / f"exited-{exit_tx}.json"
        path.write_text(json.dumps(log))
        return self.attest("base", str(path), signer)


def balance(account: str) -> int | None:
    r = post_json("https://test.rpc.fastnear.com", {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "view_account", "finality": "final", "account_id": account}})
    return int(r["result"]["amount"]) if "result" in r else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--account", required=True, help="your NEAR testnet account")
    ap.add_argument("--key", type=Path, help="its key file (default ~/.near-credentials/testnet/<account>.json)")
    ap.add_argument("--wait", action="store_true", help="wait for the next rescue window instead of exiting")
    a = ap.parse_args()
    key = a.key or Path.home() / ".near-credentials" / "testnet" / f"{a.account}.json"
    if not key.is_file():
        sys.exit(f"no key file at {key}; create an account with the command in docs/practice.md, or pass --key")
    bal = balance(a.account)
    if bal is None or bal < 10**23:
        sys.exit(f"{a.account} needs at least 0.1 NEAR on testnet for gas (it has {0 if bal is None else bal / 1e24:.3f})")

    chain = VisitorChain(a.account, key)
    st = chain.status()
    while not (rescue_due(st) or st["mode"] == "flattening"):
        if not a.wait:
            due = st["last_heartbeat"] + st["heartbeat_s"]
            sys.exit(f"no rescue is due on {chain.judge} (mode {st['mode']}; the manager's window runs to "
                     f"{time.strftime('%H:%M UTC', time.gmtime(due))}). Run with --wait, or see docs/practice.md for the daily window.")
        time.sleep(60)
        st = chain.status()
    if st["job"] and st["job"]["agent"] != a.account:
        print(f"{st['job']['agent']} is rescuing it right now; you may take over once their job expires "
              f"({time.strftime('%H:%M UTC', time.gmtime(st['job']['expires_at']))}).")
        return
    print(f"Rescuing {chain.judge} as {a.account}: the manager is silent and the investor's mandate says exit.")
    paid_before = len(chain.strategy()["payouts"])
    Rescuer(chain, a.account, chain.out / "rescue.jsonl").run()
    paid = [p for p in chain.strategy()["payouts"][paid_before:] if p["agent"] == a.account]
    for p in paid:
        print(f"The judge paid you {int(p['amount']) / 1e24:.3f} NEAR for the {p['reason']} leg.")
    if not paid:
        print("No reward yet: the judge pays each leg only once the investor's address shows it delivered.")


if __name__ == "__main__":
    main()
