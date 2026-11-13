"""A confidential mandate on MAINNET (authorized by the user, small amounts): a NEAR Intents Agent API account whose
owner is a key NEAR's MPC network derives for a testnet account. No private key for the owner exists anywhere:
every owner action (create, policy, freeze) is EIP-712 typed data that the MPC network signs on request.

    python3 scripts/mainnet/mandate.py owner          the MPC-derived owner and its NEAR wallet account
    python3 scripts/mainnet/mandate.py create         create the agent with Klear's mandate as its confidential policy
    python3 scripts/mainnet/mandate.py agent          the agent, its policy and its confidential balances
    python3 scripts/mainnet/mandate.py grant [label]  the owner grants the manager the right to act (token kept in .secrets/)
    python3 scripts/mainnet/mandate.py rules          dry runs, no funds: what the policy allows and refuses
    python3 scripts/mainnet/mandate.py freeze         the owner freezes the agent (an exit trigger's first step)
    python3 scripts/mainnet/mandate.py unfreeze       the owner lifts the freeze
    python3 scripts/mainnet/mandate.py deposit        a deposit address for HyperCore USDC into the confidential balance
    python3 scripts/mainnet/mandate.py destinations   the owner sets where withdrawals may go: the user's own addresses
    python3 scripts/mainnet/mandate.py manage         the sealed AI decides one action in a TEE and runs it under its grant
    python3 scripts/mainnet/mandate.py stranger       a live withdrawal to anyone else, which the policy must refuse
    python3 scripts/mainnet/mandate.py exit           the owner cuts the AI off, grants the exit, and everything goes home
    python3 scripts/mainnet/mandate.py status <id>    an owner intent's status

Reads NEAR_INTENTS_AGENT_API_KEY and NEAR_INTENTS_AGENT_API_URL from .env; never prints them. Every step is
recorded in docs/results/mandate/run.jsonl.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agents"))

from eth_account import Account  # noqa: E402
from eth_account.messages import _hash_eip191_message, encode_typed_data  # noqa: E402

from keel_agents import registry  # noqa: E402
from keel_agents.net import _CTX  # noqa: E402
from keel_agents.registry import B58, MPC, keccak  # noqa: E402

OUT = ROOT / "docs" / "results" / "mandate"
PATH = "klear/mandate/1"
NEAR = str(ROOT / "node_modules" / ".bin" / "near")


def env() -> dict:
    e = dict(os.environ)
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            e.setdefault(k.strip(), v.strip())
    for line in (OUT / "env").read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            e[k] = v
    return e


E = env()
ACCOUNT = E["MANDATE_OWNER_ACCOUNT"]


def note(kind: str, **fields) -> None:
    with (OUT / "run.jsonl").open("a") as f:
        f.write(json.dumps({"at": int(time.time()), "kind": kind, **fields}) + "\n")
    print(f"{kind}: {json.dumps(fields)[:300]}")


def api(method: str, path: str, body: dict | None = None, headers: dict | None = None) -> dict:
    req = urllib.request.Request(E["NEAR_INTENTS_AGENT_API_URL"] + path, json.dumps(body).encode() if body is not None else None,
                                 {"content-type": "application/json", "x-api-key": E["NEAR_INTENTS_AGENT_API_KEY"],
                                  "user-agent": "klear/0.1", **(headers or {})}, method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=60, context=_CTX))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: {e.code} {e.read().decode()[:800]}") from None


def owner() -> dict:
    key = registry.view(MPC, "derived_public_key", {"path": PATH, "predecessor": ACCOUNT, "domain_id": 0}).removeprefix("secp256k1:")
    n = 0
    for c in key:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(64, "big")
    return {"type": "evm", "address": "0x" + keccak(raw)[12:].hex(), "chain_id": 8453, "public_key": "0x" + raw.hex()}


def mpc_sign(digest: bytes) -> str:
    """NEAR's MPC network signs `digest` for (ACCOUNT, PATH); returns a 65-byte 0x signature (r, s, v)."""
    args = {"request": {"path": PATH, "payload_v2": {"Ecdsa": digest.hex()}, "domain_id": 0}}
    out = OUT / f"mpc-sign-{int(time.time())}.txt"
    with out.open("w") as f:
        subprocess.run([NEAR, "contract", "call-function", "as-transaction", MPC, "sign", "json-args", json.dumps(args),
                        "prepaid-gas", "300.0 Tgas", "attached-deposit", "1 yoctoNEAR", "sign-as", ACCOUNT, "network-config",
                        "testnet", "sign-with-access-key-file", str(ROOT / ".secrets" / "near" / f"{ACCOUNT}.json"), "send"],
                       stdout=f, stderr=subprocess.STDOUT, cwd=ROOT, timeout=180)
    text = re.sub(r"\x1b\[[0-9;]*m", "", out.read_text())
    tx = re.search(r"Transaction ID: ([A-Za-z0-9]+)", text)
    at = text.find('"big_r"')
    if at < 0:
        raise RuntimeError(f"no MPC signature; see {out.relative_to(ROOT)}")
    resp, _ = json.JSONDecoder().raw_decode(text[text.rfind("{", 0, at):])
    r = bytes.fromhex(resp["big_r"]["affine_point"])[1:]  # compressed point: drop the parity byte, keep x
    s = bytes.fromhex(resp["s"]["scalar"])
    note("mpc-signed", digest=digest.hex(), tx=tx and tx.group(1))
    return "0x" + (r + s + bytes([27 + resp["recovery_id"]])).hex()


def owner_intent(kind: str, **fields) -> dict:
    """generate → MPC-sign → check the signature recovers to the owner → submit → wait for a terminal status."""
    g = api("POST", "/v1/generate-intent", {"type": kind, **fields})
    payload = g["intent"]["payload"]
    note("generated", type=kind, correlation_id=g["correlation_id"], agent_id=g.get("agent_id"), standard=g["intent"]["standard"],
         summary=g.get("preview", {}).get("summary"), policy_hash=g.get("preview", {}).get("policy_hash"))
    digest = _hash_eip191_message(encode_typed_data(full_message=payload))
    sig = mpc_sign(digest)
    signer = g["signer"]["address"]
    if Account._recover_hash(digest, signature=sig).lower() != signer.lower():
        raise RuntimeError("the MPC signature does not recover to the owner: not submitted")
    api("POST", "/v1/submit-intent", {"type": kind, "correlation_id": g["correlation_id"],
                                       "signed_data": {"standard": "eip712", "payload": payload, "signature": sig}})
    st = wait(g["correlation_id"])
    d = st.get("details") or {}
    note("submitted", type=kind, correlation_id=g["correlation_id"], status=st.get("status"), agent_id=g.get("agent_id"),
         failure_code=st.get("failure_code"), transaction_hash=d.get("transaction_hash"), revision=d.get("revision"),
         policy_hash=d.get("policy_hash"), grant_id=(d.get("grant") or {}).get("grant_id"))
    return {**g, "final": st}


def wait(correlation_id: str) -> dict:
    for _ in range(20):
        st = api("GET", f"/v1/status?correlation_id={correlation_id}&wait_ms=30000")
        if st.get("status") in ("SUCCESS", "FAILED", "EXPIRED", "REJECTED", "CANCELLED"):
            return st
    return st


def mandate_policy() -> dict:
    """Klear's mandate as a confidential Agent API policy: swaps only within a USD budget and an hourly cap,
    withdrawals only to the investor (the test account, an implicit NEAR account)."""
    investor = json.loads((ROOT / ".secrets" / "near-mainnet" / "owner.json").read_text())["account_id"]
    return {"frozen": False, "actions": ["swap", "withdraw"], "confidential": True, "owner_approval": False,
            "assets": "any", "limits": {}, "max_actions_per_hour": 10,
            "destinations": {"mode": "only", "list": [{"action": "withdraw", "chain": "near", "address": investor, "memo": None}]},
            "budget": {"daily_usd": "5", "weekly_usd": "10", "monthly_usd": None}, "timelock_ms": 0}


USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"  # USDC on NEAR
WNEAR = "nep141:wrap.near"
HYPERCORE_USDC = "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054"
GRANTS = ROOT / ".secrets" / "mandate"
BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"  # Base USDC inside NEAR Intents
# The user funded this account; its only exits are the user's own addresses.
HOME = {"base": "0x2b10cded26f15b85039d07c85d5a259b9aea5fd4", "near": "poorcheese6608.near"}

SYSTEM = """You manage a confidential NEAR Intents account for an investor, under the investor's mandate, which the
account enforces whatever you answer: swaps and withdrawals only, a USD budget per day and per week, withdrawals only
to the investor. Decide one action now: swap some USDC for NEAR, or hold. Explain in one sentence."""
SCHEMA = {"type": "object", "properties": {"action": {"type": "string", "enum": ["swap", "hold"]},
          "amount_usdc": {"type": "number", "minimum": 0}, "reason": {"type": "string"}},
          "required": ["action", "amount_usdc", "reason"]}


def grant(label: str) -> None:
    """A new grant token (`ngt_` + 32 random bytes, base64url): only its sha256 leaves this machine, signed by the owner."""
    token = "ngt_" + base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    GRANTS.mkdir(parents=True, exist_ok=True)
    path = GRANTS / f"{label}.token"
    path.write_text(token)
    path.chmod(0o600)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    owner_intent("grant_issue", agent_id=E["MANDATE_AGENT_ID"], label=label, credential=hashlib.sha256(token.encode()).hexdigest(),
                 expires_at=expires)


def rules() -> None:
    """Dry runs: each answer lists the rules a live request would break. No funds are needed or moved."""
    a, token = E["MANDATE_AGENT_ID"], (GRANTS / "klear-manager.token").read_text().strip()
    investor = json.loads((ROOT / ".secrets" / "near-mainnet" / "owner.json").read_text())["account_id"]
    stranger = "0" * 64  # any other account: not on the policy's list
    tries = [
        ("swap 1 USDC for NEAR", "swap", {"origin_asset": USDC, "destination_asset": WNEAR, "amount": "1000000", "dry": True}, {}),
        ("swap 50 USDC for NEAR", "swap", {"origin_asset": USDC, "destination_asset": WNEAR, "amount": "50000000", "dry": True}, {}),
        ("withdraw 1 USDC to the investor", "withdraw", {"asset": USDC, "amount": "1000000", "chain": "near", "recipient": investor, "dry": True},
         {"x-grant-token": token, "idempotency-key": str(uuid.uuid4())}),
        ("withdraw 1 USDC to anyone else", "withdraw", {"asset": USDC, "amount": "1000000", "chain": "near", "recipient": stranger, "dry": True},
         {"x-grant-token": token, "idempotency-key": str(uuid.uuid4())}),
    ]
    for what, ep, body, h in tries:
        try:
            r = api("POST", f"/v1/agents/{a}/{ep}", body, h)
            note("dry-run", what=what, warnings=[w.get("code", w) if isinstance(w, dict) else w for w in r.get("warnings", [])],
                 spend=r.get("spend", {}).get("amount_usd"))
        except RuntimeError as e:
            note("dry-run", what=what, refused=str(e)[:300])


def agent_id() -> str:
    return E["MANDATE_AGENT_ID"]


def token(label: str) -> str:
    return (GRANTS / f"{label}.token").read_text().strip()


def balances() -> list[dict]:
    b = api("GET", f"/v1/agents/{agent_id()}/balances")
    rows = b.get("data") or b.get("balances") or []
    return [x for x in rows if str(x.get("balance_raw", x.get("balance", "0"))) not in ("0", "")]


def run(kind: str, path: str, body: dict, grant_label: str) -> dict:
    """A live execution under a grant; waits for its status. A refusal comes back as an error, before any provider call."""
    try:
        r = api("POST", f"/v1/agents/{agent_id()}/{path}", body, {"x-grant-token": token(grant_label), "idempotency-key": str(uuid.uuid4())})
    except RuntimeError as e:
        note(f"{kind}-refused", request=body, error=str(e)[-400:])
        return {"refused": str(e)}
    st = wait(r["correlation_id"]) if r.get("correlation_id") else r
    note(kind, request=body, correlation_id=r.get("correlation_id"), status=st.get("status"),
         details={k: (st.get("details") or {}).get(k) for k in ("amount_in", "amount_out", "transaction_hash", "usd_value")})
    return st


def destinations() -> None:
    cur = api("GET", f"/v1/agents/{agent_id()}/policy")
    policy = dict(cur["policy"])
    policy["destinations"] = {"mode": "only", "list": [{"action": "withdraw", "chain": "base", "address": HOME["base"], "memo": None},
                                                       {"action": "withdraw", "chain": "near", "address": HOME["near"], "memo": None}]}
    owner_intent("policy_update", agent_id=agent_id(), policy=policy, expected_revision=cur["revision"])


def manage() -> None:
    """The sealed AI decides in a TEE (keel_agents/sealed.py) and its action runs under the manager's grant."""
    from keel_agents import sealed

    urls = urllib.request.urlopen(urllib.request.Request(E["NEAR_INTENTS_AGENT_API_URL"] + "/v1/tokens", headers={"user-agent": "klear/0.1"}), timeout=30, context=_CTX)
    near_usd = next(t["price"] for t in json.load(urls)["data"] if t["asset_id"] == WNEAR)
    usage = api("GET", f"/v1/agents/{agent_id()}/policy")["usage"]["budget"]
    system = SYSTEM + "\n\nThe investor's strategy, which you follow within the mandate:\n" + (ROOT / ".secrets" / "strategy-mandate.md").read_text()
    prompt = json.dumps({"balances": [{"asset": b["asset_id"], "balance": b.get("balance")} for b in balances()],
                         "near_price_usd": near_usd, "budget_remaining_usd": {k: v["remaining_usd"] for k, v in usage.items()}}, indent=1)
    d, receipt = sealed.decide("mandate-manager", system, prompt, SCHEMA, OUT / "decisions.jsonl", ROOT / ".secrets" / "sealed" / "mandate.jsonl")
    note("sealed-decision", decision={k: d[k] for k in ("action", "amount_usdc")}, receipt=receipt)
    if d["action"] == "swap" and d["amount_usdc"] > 0:
        run("swap", "swap", {"origin_asset": BASE_USDC, "destination_asset": WNEAR, "amount": str(round(d["amount_usdc"] * 1e6)),
                             "note": f"sealed decision {receipt['completion']}"}, "klear-manager")


def stranger() -> None:
    run("withdraw-to-stranger", "withdraw", {"asset": BASE_USDC, "amount": "500000", "chain": "base",
                                             "recipient": "0x000000000000000000000000000000000000dEaD"}, "klear-manager")


def exit_() -> None:
    """The confidential rescue: the owner revokes the AI's grant, grants the exit, and every balance goes to the user."""
    grants = api("GET", f"/v1/agents/{agent_id()}/grants").get("data", [])
    for g in grants:
        if g.get("label") == "klear-manager" and not g.get("revoked_at"):
            owner_intent("grant_revoke", agent_id=agent_id(), grant_id=g["grant_id"])
    run("ai-after-revoke", "withdraw", {"asset": BASE_USDC, "amount": "100000", "chain": "base", "recipient": HOME["base"], "dry": True}, "klear-manager")
    grant("klear-exit")
    for b in balances():
        raw = str(b.get("available_raw") or b.get("balance_raw"))
        if b["asset_id"] == WNEAR:
            run("exit-withdraw", "withdraw", {"asset": WNEAR, "amount": raw, "chain": "near", "recipient": HOME["near"]}, "klear-exit")
        elif b["asset_id"] == BASE_USDC:
            run("exit-withdraw", "withdraw", {"asset": BASE_USDC, "amount": raw, "chain": "base", "recipient": HOME["base"]}, "klear-exit")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "owner"
    if cmd == "owner":
        o = owner()
        print(json.dumps({"testnet_account": ACCOUNT, "path": PATH, "owner": o["address"]}, indent=1))
    elif cmd == "create":
        r = owner_intent("agent_create", name="klear-mandate", owner=owner(), policy=mandate_policy())
        if r["final"].get("status") == "SUCCESS":
            with (OUT / "env").open("a") as f:
                f.write(f"MANDATE_AGENT_ID={r['agent_id']}\n")
    elif cmd == "agent":
        a = E["MANDATE_AGENT_ID"]
        print(json.dumps({"agent": api("GET", f"/v1/agents/{a}"), "policy": api("GET", f"/v1/agents/{a}/policy"),
                          "balances": api("GET", f"/v1/agents/{a}/balances")}, indent=1)[:4000])
    elif cmd == "grant":
        grant(sys.argv[2] if len(sys.argv) > 2 else "klear-manager")
    elif cmd == "rules":
        rules()
    elif cmd == "freeze":
        owner_intent("agent_freeze", agent_id=E["MANDATE_AGENT_ID"])
    elif cmd == "unfreeze":
        owner_intent("agent_unfreeze", agent_id=E["MANDATE_AGENT_ID"])
    elif cmd == "deposit":
        r = api("POST", f"/v1/agents/{E['MANDATE_AGENT_ID']}/deposit", {"origin_asset": HYPERCORE_USDC, "destination_asset": USDC},
                {"idempotency-key": str(uuid.uuid4())})
        note("deposit-address", details={k: r.get("details", {}).get(k) for k in ("deposit_address", "memo", "min_amount", "expires_at")},
             correlation_id=r.get("correlation_id"))
    elif cmd == "destinations":
        destinations()
    elif cmd == "manage":
        manage()
    elif cmd == "stranger":
        stranger()
    elif cmd == "exit":
        exit_()
    elif cmd == "status":
        print(json.dumps(api("GET", f"/v1/status?correlation_id={sys.argv[2]}"), indent=1))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
