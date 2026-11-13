"""A confidential mandate whose owner is a locked Klear contract (contracts/klear-owner), on the Agent API (mainnet).

    python3 scripts/mainnet/owner.py setup       the investor has the contract sign the account's creation and the
                                                 AI's grant, then seals it
    python3 scripts/mainnet/owner.py exit        refusals first (no trigger, another agent, setup after seal), then the
                                                 investor's exit: anyone gets the AI's grant revoked and an exit grant
    python3 scripts/mainnet/owner.py status

Every owner signature comes from the contract's own call to NEAR's MPC network; this script only relays the API's
payloads to it and the signatures back. Reads docs/results/owner/env; the API key and grant tokens never print.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agents"))
sys.path.insert(0, str(ROOT / "scripts" / "mainnet"))

from eth_account import Account  # noqa: E402
from eth_account.messages import _hash_eip191_message, encode_typed_data  # noqa: E402

import mandate  # noqa: E402  the API client and status wait
from keel_agents import registry  # noqa: E402
from keel_agents.registry import B58, MPC, keccak  # noqa: E402

OUT = ROOT / "docs" / "results" / "owner"
NEAR = str(ROOT / "node_modules" / ".bin" / "near")
E = dict(l.split("=", 1) for l in (OUT / "env").read_text().split() if "=" in l)
OWNER, INVESTOR, MANAGER, STRANGER = E["OWNER_CONTRACT"], E["INVESTOR"], E["MANAGER"], E["STRANGER"]
PATH = "klear/mandate/1"
HOME = mandate.HOME
GRANTS = ROOT / ".secrets" / "owner"


def note(kind: str, **fields) -> None:
    with (OUT / "run.jsonl").open("a") as f:
        f.write(json.dumps({"at": int(time.time()), "kind": kind, **fields}) + "\n")
    print(f"{kind}: {json.dumps(fields)[:320]}")


def owner_key() -> dict:
    key = registry.view(MPC, "derived_public_key", {"path": PATH, "predecessor": OWNER, "domain_id": 0}).removeprefix("secp256k1:")
    n = 0
    for c in key:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(64, "big")
    return {"type": "evm", "address": "0x" + keccak(raw)[12:].hex(), "chain_id": 8453, "public_key": "0x" + raw.hex()}


def call(signer: str, method: str, args: dict, gas: str = "300.0 Tgas") -> tuple[str | None, str | None, dict | None]:
    """(tx, refusal, return value) of a call on the owner contract."""
    p = subprocess.run([NEAR, "contract", "call-function", "as-transaction", OWNER, method, "json-args", json.dumps(args), "prepaid-gas", gas,
                        "attached-deposit", "0 NEAR", "sign-as", signer, "network-config", "testnet", "sign-with-access-key-file",
                        str(ROOT / ".secrets" / "near" / f"{signer}.json"), "send"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=ROOT)
    (OUT / f"{method}-{int(time.time())}.txt").write_text(p.stdout)
    text = re.sub(r"\x1b\[[0-9;]*m", "", p.stdout)
    tx = re.search(r"Transaction ID: ([A-Za-z0-9]+)", text)
    err = re.search(r"Smart contract panicked: ([^\n\"]+)", text)
    at = text.find('"signature"')
    value = json.JSONDecoder().raw_decode(text[text.rfind("{", 0, at):])[0] if at >= 0 else None
    return (tx and tx.group(1)), (err and err.group(1).strip()), value


def contract_signs(signer: str, kind: str, g: dict) -> str | None:
    """Have the contract sign the API's payload; check the signature recovers to the owner; submit; wait."""
    payload = g["intent"]["payload"]
    method = "sign_setup" if payload["primaryType"] == "WalletMessage" else "sign_grant"
    tx, refused, value = call(signer, method, {"message": payload["message"]})
    if refused or not value:
        note(f"{kind}-refused", by=signer, tx=tx, refused=refused)
        return None
    digest = _hash_eip191_message(encode_typed_data(full_message=payload))
    ok = Account._recover_hash(digest, signature=value["signature"]).lower() == g["signer"]["address"].lower()
    mandate.api("POST", "/v1/submit-intent", {"type": kind, "correlation_id": g["correlation_id"],
                                               "signed_data": {"standard": "eip712", "payload": payload, "signature": value["signature"]}})
    st = mandate.wait(g["correlation_id"])
    note(kind, by=signer, tx=tx, what=value.get("what"), recovers_to_owner=ok, status=st.get("status"),
         agent_id=g.get("agent_id"), grant_id=((st.get("details") or {}).get("grant") or {}).get("grant_id"))
    return st.get("status")


def new_grant(label: str, agent_id: str) -> dict:
    token = "ngt_" + base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    GRANTS.mkdir(parents=True, exist_ok=True)
    (GRANTS / f"{label}.token").write_text(token)
    (GRANTS / f"{label}.token").chmod(0o600)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return mandate.api("POST", "/v1/generate-intent", {"type": "grant_issue", "agent_id": agent_id, "label": label,
                                                        "credential": hashlib.sha256(token.encode()).hexdigest(), "expires_at": expires})


def dry(label: str, what: str, body: dict) -> None:
    token = (GRANTS / f"{label}.token").read_text().strip()
    try:
        r = mandate.api("POST", f"/v1/agents/{E['AGENT_ID']}/withdraw", {**body, "dry": True},
                        {"x-grant-token": token, "idempotency-key": str(uuid.uuid4())})
        note("dry-run", grant=label, what=what, warnings=[w.get("code", w) if isinstance(w, dict) else w for w in r.get("warnings", [])])
    except RuntimeError as e:
        note("dry-run", grant=label, what=what, refused=str(e)[-220:])


def setup() -> None:
    o = owner_key()
    note("owner", contract=OWNER, path=PATH, address=o["address"])
    policy = {"frozen": False, "actions": ["swap", "withdraw"], "confidential": True, "owner_approval": False, "assets": "any",
              "limits": {}, "max_actions_per_hour": 10,
              "destinations": {"mode": "only", "list": [{"action": "withdraw", "chain": "base", "address": HOME["base"], "memo": None},
                                                        {"action": "withdraw", "chain": "near", "address": HOME["near"], "memo": None}]},
              "budget": {"daily_usd": "5", "weekly_usd": "10", "monthly_usd": None}, "timelock_ms": 0}
    g = mandate.api("POST", "/v1/generate-intent", {"type": "agent_create", "name": "klear-owned", "owner": o, "policy": policy})
    if contract_signs(INVESTOR, "agent_create", g) != "SUCCESS":
        sys.exit("creation failed")
    with (OUT / "env").open("a") as f:
        f.write(f"AGENT_ID={g['agent_id']}\n")
    E["AGENT_ID"] = g["agent_id"]
    contract_signs(INVESTOR, "grant_issue", new_grant("ai-manager", g["agent_id"]))
    tx, refused, _ = call(INVESTOR, "seal", {"agent_id": g["agent_id"]}, "30.0 Tgas")
    note("seal", tx=tx, refused=refused)


def exit_() -> None:
    a = E["AGENT_ID"]
    grants = mandate.api("GET", f"/v1/agents/{a}/grants").get("data", [])
    ai = next(g for g in grants if g.get("label") == "ai-manager" and not g.get("revoked_at"))
    revoke = lambda: mandate.api("POST", "/v1/generate-intent", {"type": "grant_revoke", "agent_id": a, "grant_id": ai["grant_id"]})  # noqa: E731
    dry("ai-manager", "the AI previews a withdrawal to the investor", {"asset": mandate.USDC, "amount": "1000000", "chain": "near", "recipient": HOME["near"]})
    # Refusals, on chain, before the trigger and after seal.
    contract_signs(STRANGER, "grant_revoke", revoke())
    other = mandate.api("POST", "/v1/generate-intent", {"type": "grant_revoke", "agent_id": mandate.agent_id(),
                                                         "grant_id": next(g["grant_id"] for g in mandate.api("GET", f"/v1/agents/{mandate.agent_id()}/grants")["data"])})
    contract_signs(INVESTOR, "grant_revoke", other)
    freeze = mandate.api("POST", "/v1/generate-intent", {"type": "agent_freeze", "agent_id": a})
    contract_signs(INVESTOR, "agent_freeze", freeze)
    # The trigger, then the exit by a stranger.
    tx, refused, _ = call(INVESTOR, "request_exit", {}, "30.0 Tgas")
    note("request_exit", tx=tx, refused=refused, state=registry.view(OWNER, "get_state"))
    contract_signs(STRANGER, "grant_revoke", revoke())
    dry("ai-manager", "the AI, after its grant is revoked", {"asset": mandate.USDC, "amount": "1000000", "chain": "near", "recipient": HOME["near"]})
    contract_signs(STRANGER, "grant_issue", new_grant("exit", a))
    dry("exit", "the exit grant previews a withdrawal to the investor", {"asset": mandate.USDC, "amount": "1000000", "chain": "near", "recipient": HOME["near"]})
    dry("exit", "the exit grant previews a withdrawal to anyone else", {"asset": mandate.USDC, "amount": "1000000", "chain": "base",
                                                                         "recipient": "0x000000000000000000000000000000000000dEaD"})


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "setup":
        setup()
    elif cmd == "exit":
        exit_()
    else:
        print(json.dumps(registry.view(OWNER, "get_state"), indent=1))


if __name__ == "__main__":
    main()
