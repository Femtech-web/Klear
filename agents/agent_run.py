"""A recorded run of an off-the-shelf agent: Claude Code, given only Klear's MCP servers and its own NEAR account,
finds the strategy that needs a rescue, checks it, rescues it, and is paid by the judge.

    python3 agents/agent_run.py [--sealed-trade] [--agent <account>]

On the deleverage strategy (docs/results/delever): the investor rearms it and the relayer funds it; with
--sealed-trade the sealed manager first decides in a TEE (the investor's private .secrets/strategy-trade.md) and its
order carries the TEE's receipt on chain; then the investor asks to exit, the courier pays the EVM gas, and Claude
Code is started with a one-paragraph task and the MCP servers, nothing else. Its full transcript and the judge's
payouts go to docs/results/agent-runs/<run>/.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

from keel_agents import llm, registry
from keel_agents.chain import ROOT, Chain
from keel_agents.net import _CTX

STRATEGY = "docs/results/delever"
HOSTED = "https://klear-near.vercel.app/api/mcp"
TASK = """You are a guardian agent on NEAR testnet. Your account is {account} and its key file is {key}.
Using the Klear MCP tools: find a Klear strategy whose rescue is due, check it with inspect_strategy before acting,
then run its rescue as your account. Follow it until both legs are delivered and you have been paid. Then report
what happened: the strategy, the checks, each step, and what you were paid."""


def hosted_live() -> bool:
    req = urllib.request.Request(HOSTED, json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode(),
                                 {"content-type": "application/json", "accept": "application/json, text/event-stream"})
    try:
        return "result" in json.load(urllib.request.urlopen(req, timeout=20, context=_CTX))
    except Exception:  # noqa: BLE001  not deployed yet: the local server alone
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sealed-trade", action="store_true")
    ap.add_argument("--agent", required=True, help="the agent's NEAR testnet account (key in .secrets/near/)")
    a = ap.parse_args()
    chain = Chain(STRATEGY)
    out = ROOT / "docs" / "results" / "agent-runs" / time.strftime("%Y%m%d-%H%M")
    out.mkdir(parents=True, exist_ok=True)
    log = out / "run.jsonl"

    def note(kind: str, **f) -> None:
        llm.note(log, "agent-run", kind, **f)
        print(f"[{time.strftime('%H:%M:%S')}] {kind}: {json.dumps(f)[:240]}", flush=True)

    def sh(*args: str, env: dict | None = None) -> str:
        for _ in range(4):
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
    if int(chain.status()["pool"]) < 3 * 10**23:
        c = chain.fund_pool(1.0, chain.state["PRACTICE"])
        note("fund-pool", tx=c.tx, refused=c.error)
    note("fund", out=sh("scripts/testnet/practice.sh", "fund", "3.5", str(4 * 10**15), env={**chain.env, "KEEL_STRATEGY": "delever"}))
    found = chain.attested_spot(1800)
    spot = found[0] if found else sh("scripts/testnet/g7.sh", "spot", f"ar-{int(time.time())}", chain.state["PRACTICE"]).splitlines()[-1]
    (chain.out / "latest-spot").write_text(spot + "\n")
    note("spot-attested", evidence=spot)

    if a.sealed_trade:
        p = subprocess.run([sys.executable, "-u", "agents/manager.py", "--strategy", STRATEGY, "--sealed",
                            "--strategy-file", ".secrets/strategy-trade.md", "--cycles", "1"], cwd=ROOT, capture_output=True, text=True)
        note("sealed-manager", code=p.returncode, out=p.stdout.strip().splitlines()[-5:], error=p.stderr.strip()[-300:] or None)
        time.sleep(30)  # the order settles on HyperCore before the exit is requested

    note("request-exit", out=sh("scripts/testnet/g7.sh", "request-exit").splitlines()[-1:])
    courier = subprocess.Popen([sys.executable, "-u", "agents/courier.py", "--strategy", STRATEGY, "--for", "3600"], cwd=ROOT,
                               stdout=(out / "courier.log").open("a"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)

    servers = {"klear-local": {"command": str(ROOT / ".tools/venv/bin/python"), "args": [str(ROOT / "agents/mcp_server.py")]}}
    if hosted_live():
        servers["klear"] = {"type": "http", "url": HOSTED}
    (out / "mcp.json").write_text(json.dumps({"mcpServers": servers}, indent=1))
    key = ROOT / ".secrets" / "near" / f"{a.agent}.json"
    task = TASK.format(account=a.agent, key=key)
    (out / "task.txt").write_text(task + "\n")
    note("agent-start", servers=list(servers), agent=a.agent)
    paid_before = len(chain.strategy()["payouts"])
    t0 = time.time()
    with (out / "transcript.jsonl").open("w") as f:
        p = subprocess.run(["claude", "-p", task, "--mcp-config", str(out / "mcp.json"), "--strict-mcp-config", "--tools", "",
                            "--allowedTools", ",".join(f"mcp__{s}" for s in servers), "--output-format", "stream-json",
                            "--verbose", "--max-turns", "60", "--no-session-persistence"],
                           cwd=ROOT, stdout=f, stderr=subprocess.STDOUT, env={**os.environ, "MCP_TOOL_TIMEOUT": "960000"})
    courier.terminate()
    paid = [x for x in chain.strategy()["payouts"][paid_before:] if x["agent"] == a.agent]
    result = next((json.loads(l) for l in (out / "transcript.jsonl").read_text().splitlines()[::-1] if '"type":"result"' in l.replace(" ", "")), {})
    note("agent-done", code=p.returncode, minutes=round((time.time() - t0) / 60, 1), paid=paid,
         turns=result.get("num_turns"), report=(result.get("result") or "")[-1200:])


if __name__ == "__main__":
    main()
