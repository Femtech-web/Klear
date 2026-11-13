"""Klear for AI agents, over MCP: find strategies that need a guardian, check one before trusting it, and run
its rescue with your own NEAR account.

    claude mcp add klear-local -- .tools/venv/bin/python agents/mcp_server.py      (from the repository's root)

The read tools only read the chains. `start_rescue` signs testnet transactions with the account and key file
you name, through NEAR's CLI, on this machine: the same rescue as `make rescue`. The judge decides every order
and every destination; an agent using these tools can bring the money home, never anywhere else.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from keel_agents import registry
from keel_agents.chain import ROOT

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
LOGS = ROOT / ".keel-visitor" / "mcp"

server = MCPServer(
    "klear",
    instructions=(
        "Klear strategies on NEAR testnet: an investor's rules in a keyless NEAR contract (the judge) that alone signs for "
        "the strategy's accounts on Hyperliquid and Base. When a strategy's manager fails, anyone may rescue it and is "
        "paid by the judge only after the investor's addresses show the money. Start with list_strategies; run "
        "inspect_strategy before acting on one."
    ),
)


@server.tool(annotations=READ)
def list_strategies() -> list[dict]:
    """Every strategy the Klear factory created: its mode, whether a rescue is due now and why, any open job, and its reward pool."""
    return registry.strategies()


@server.tool(annotations=READ)
def inspect_strategy(judge: str) -> dict:
    """The six checks to run before trusting a strategy (created by the factory, no keys, the factory's code, both
    accounts controlled only by the judge's MPC keys, both paying only the investor), with the values compared, and its mandate."""
    return registry.inspect(registry.account(judge))


@server.tool(annotations=READ)
def rescue_status(judge: str) -> dict:
    """Where a strategy's rescue stands: whether one is due, who holds the job, each leg's state, and what was paid."""
    s = registry.view(registry.account(judge), "get_strategy")
    st = registry.view(judge, "status")
    r = s["rescue"]
    return {
        "mode": st["mode"],
        "rescue_due": registry.due(st),
        "job": st["job"],
        "legs": {"hyperliquid": r["perp"], "base": r["spot"]},
        "paid": [{"to": p["agent"], "near": round(int(p["amount"]) / 1e24, 6), "for": p["reason"]} for p in s["payouts"]],
        "manager_seen_s_ago": int(time.time()) - st["last_heartbeat"] if st["manager"] else None,
    }


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True))
def start_rescue(judge: str, account: str, key_file: str = "") -> dict:
    """Start the rescue of `judge` as `account` (NEAR testnet), in the background; returns where its log is.
    `key_file` defaults to NEAR CLI's ~/.near-credentials/testnet/<account>.json. It waits until a rescue is due,
    then attests evidence, opens the rescue, settles each leg and confirms the vault's exit. Follow it with rescue_log."""
    registry.account(judge), registry.account(account)
    LOGS.mkdir(parents=True, exist_ok=True)
    log = LOGS / f"{judge}.{account}.log"
    cmd = [str(ROOT / ".tools/venv/bin/python"), "-u", "agents/rescue.py", "--account", account, "--judge", judge, "--wait"]
    if key_file:
        cmd += ["--key", str(Path(key_file).expanduser())]
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=log.open("a"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    return {"started": True, "pid": proc.pid, "log": str(log)}


@server.tool(annotations=READ)
def rescue_log(judge: str, account: str, lines: int = 40) -> str:
    """The last lines of a rescue started with start_rescue."""
    log = LOGS / f"{registry.account(judge)}.{registry.account(account)}.log"
    if not log.exists():
        return "no rescue started for this judge and account"
    return "\n".join(log.read_text().splitlines()[-max(1, min(lines, 400)):])


@server.tool(annotations=READ)
def wait_for_rescue(judge: str, account: str, max_seconds: int = 300) -> dict:
    """Wait, up to max_seconds (at most 300: call it again to keep waiting), until the rescue started with start_rescue
    pays a leg or ends, then return where it stands and its log's last lines. A whole rescue takes about 25 minutes,
    most of it Base finality."""
    log = LOGS / f"{registry.account(judge)}.{registry.account(account)}.log"
    seen = log.stat().st_size if log.exists() else 0
    deadline = time.time() + max(15, min(max_seconds, 300))
    while time.time() < deadline:
        time.sleep(15)
        new = log.read_text()[seen:] if log.exists() else ""
        if any(m in new for m in ("paid you", "No reward yet", "Traceback", "no rescue is due", "job ended")):
            break
    return {"status": rescue_status(judge), "log": rescue_log(judge, account, 25)}


if __name__ == "__main__":
    server.run()
