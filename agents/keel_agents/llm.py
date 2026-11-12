"""Autonomous decisions from Claude, through the locally signed-in `claude` CLI (no API key).

Each call runs with no tools, no MCP servers and no saved session, and must return JSON matching a
schema. Every decision is appended to a JSONL log with the full prompt, the model and the answer,
so each one can be audited later and told apart from deterministic steps.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path

MODEL = "claude-sonnet-5-5"


def decide(role: str, system: str, prompt: str, schema: dict, log: Path, model: str = MODEL) -> dict:
    t0 = time.time()
    cmd = ["claude", "-p", prompt, "--model", model, "--system-prompt", system, "--output-format", "json",
           "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--json-schema", json.dumps(schema)]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    try:
        r = json.loads(p.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"claude CLI: {p.stderr.strip()[:300] or p.stdout[:300]}")
    if r.get("is_error") or r.get("structured_output") is None:
        raise RuntimeError(f"claude CLI error: {str(r.get('result'))[:300]}")
    decision = r["structured_output"]
    entry = {
        "at": int(t0), "role": role, "model": model, "kind": "autonomous",
        "prompt_sha256": hashlib.sha256((system + "\n" + prompt).encode()).hexdigest(),
        "system": system, "prompt": prompt, "decision": decision,
        "seconds": round(time.time() - t0, 1), "cost_usd_equivalent": r.get("total_cost_usd"),
    }
    with log.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return decision


def note(log: Path, role: str, kind: str, **fields) -> None:
    """Record a non-AI event (a judge verdict, a deterministic step) in the same log."""
    with log.open("a") as f:
        f.write(json.dumps({"at": int(time.time()), "role": role, "kind": kind, **fields}) + "\n")
