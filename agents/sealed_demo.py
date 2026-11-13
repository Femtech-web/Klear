"""One live sealed order: the AI manager decides inside a TEE on NEAR AI Cloud, and the locked judge bounds it.

    python3 agents/sealed_demo.py

On the deleverage strategy (`delever.keel-factory-bcf915.testnet`, docs/results/delever):
1. the investor rearms it, the relayer funds both legs, and the vault's balance is attested (Base finality);
2. the manager runs `manager.py --sealed` with the investor's private strategy (.secrets/strategy.md): the prompt
   goes end-to-end encrypted to the model's TEE, the answer is verified against its attestation, and the order
   carries the TEE's signed receipt in `propose_order`'s arguments.
Every step is recorded in docs/results/delever/sealed.jsonl and decisions.jsonl.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time

from keel_agents import llm
from keel_agents.chain import ROOT, Chain

STRATEGY = "docs/results/delever"


def main() -> None:
    chain = Chain(STRATEGY)
    log = chain.out / "sealed.jsonl"

    def note(kind: str, **f) -> None:
        llm.note(log, "sealed-demo", kind, **f)
        print(f"[{time.strftime('%H:%M:%S')}] {kind}: {json.dumps(f)[:240]}", flush=True)

    def sh(*args: str, env: dict | None = None) -> str:
        for i in range(4):
            p = subprocess.run(list(args), cwd=ROOT, env=env or chain.env, capture_output=True, text=True)
            if p.returncode == 0:
                return p.stdout.strip()
            note("retry", step=args[1] if len(args) > 1 else args[0], error=(p.stderr or p.stdout)[-200:])
            time.sleep(20)
        raise RuntimeError(f"{' '.join(args)} failed")

    st = chain.status()
    if st["mode"] == "flattened":
        c = chain.rearm()
        note("rearm", tx=c.tx, refused=c.error)
    note("fund", out=sh("scripts/testnet/practice.sh", "fund", "3.5", str(4 * 10**15), env={**chain.env, "KEEL_STRATEGY": "delever"}))
    found = chain.attested_spot(1800)
    spot = found[0] if found else sh("scripts/testnet/g7.sh", "spot", f"sl-{int(time.time())}", chain.state["PRACTICE"]).splitlines()[-1]
    (chain.out / "latest-spot").write_text(spot + "\n")
    note("spot-attested", evidence=spot)

    p = subprocess.run([sys.executable, "-u", "agents/manager.py", "--strategy", STRATEGY, "--sealed",
                        "--strategy-file", ".secrets/strategy.md", "--cycles", "1"], cwd=ROOT, capture_output=True, text=True)
    note("sealed-manager", code=p.returncode, out=p.stdout.strip().splitlines()[-6:], error=p.stderr.strip()[-400:] or None)


if __name__ == "__main__":
    main()
