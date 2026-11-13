"""Back-to-back recorded agent runs (agents/agent_run.py), for an unattended stretch such as a night.

    python3 agents/agent_batch.py --agent <account> --runs 6 [--practice-at 14:45]

With --practice-at (UTC), the first run takes the practice strategy's rescue in the daily drill's window, whose courier
pays the gas. The deleverage runs then wait until the drill's GitHub run has finished, since both use the relayer.
The batch stops at the first deleverage run that fails or is not paid.
"""
from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "docs" / "results" / "agent-runs"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def wait_until(hhmm: str) -> None:
    now = datetime.datetime.now(datetime.UTC)
    h, m = map(int, hhmm.split(":"))
    at = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if at > now:
        log(f"waiting until {hhmm} UTC")
        time.sleep((at - now).total_seconds())


def drill_running() -> bool:
    p = subprocess.run(["gh", "run", "list", "-w", "drill", "-L", "1", "--json", "status"], cwd=ROOT, capture_output=True, text=True)
    try:
        return json.loads(p.stdout)[0]["status"] != "completed"
    except (ValueError, IndexError, KeyError):
        return True  # unknown: wait rather than share the relayer with a live drill


def run(agent: str, *extra: str) -> dict:
    before = {d.name for d in RUNS.iterdir() if d.is_dir()}
    p = subprocess.run([sys.executable, "-u", "agents/agent_run.py", "--agent", agent, *extra], cwd=ROOT)
    new = sorted(d for d in RUNS.iterdir() if d.is_dir() and d.name not in before)
    done = {}
    if new:
        for line in (new[-1] / "run.jsonl").read_text().splitlines():
            e = json.loads(line)
            if e["kind"] == "agent-done":
                done = e
    log(f"run {new[-1].name if new else '?'}: exit {p.returncode}, paid {len(done.get('paid', []))} leg(s)")
    return {"ok": p.returncode == 0 and bool(done.get("paid")), **done}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True)
    ap.add_argument("--runs", type=int, default=6, help="deleverage runs")
    ap.add_argument("--practice-at", help="HH:MM UTC: first, one run on the practice strategy in the drill's window")
    a = ap.parse_args()

    if a.practice_at:
        wait_until(a.practice_at)
        run(a.agent, "--practice")
    for i in range(a.runs):
        while drill_running():
            log("the drill is running; waiting")
            time.sleep(300)
        log(f"deleverage run {i + 1} of {a.runs}")
        if not run(a.agent)["ok"]:
            log("stopping: that run failed or was not paid")
            break


if __name__ == "__main__":
    main()
