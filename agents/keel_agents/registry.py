"""Strategies as a guardian sees them: the factory's registry, each judge's status, and the six checks to run
before trusting one. Read-only: views on NEAR and eth_calls on HyperEVM and Base."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import time

from eth_utils import keccak

from . import evm
from .net import post_json

NEAR_RPC = "https://test.rpc.fastnear.com"
FACTORY = "keel-factory-bcf915.testnet"
MPC = "v1.signer-prod.testnet"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
# A NEAR account id (2-64 chars of a-z 0-9 . _ -, no leading or doubled separators): also safe in a file name.
ACCOUNT = re.compile(r"^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$")


def account(name: str) -> str:
    if not ACCOUNT.match(name or ""):
        raise ValueError(f"not a NEAR account id: {name!r}")
    return name


def _query(params: dict) -> dict:
    r = post_json(NEAR_RPC, {"jsonrpc": "2.0", "id": 1, "method": "query", "params": {"finality": "final", **params}})
    if "result" not in r:
        raise RuntimeError(json.dumps(r.get("error"))[:200])
    return r["result"]


def view(account: str, method: str, args: dict | None = None):
    r = _query({"request_type": "call_function", "account_id": account, "method_name": method,
                "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()})
    return json.loads(bytes(r["result"]))


def keys(account: str) -> int:
    return len(_query({"request_type": "view_access_key_list", "account_id": account})["keys"])


def code_hash(account: str) -> str:
    return hashlib.sha256(base64.b64decode(_query({"request_type": "view_code", "account_id": account})["code_base64"])).hexdigest()


def derived_address(account: str, path: str) -> str:
    """The EVM address of the key NEAR's MPC network derives for (account, path): only that account can use it."""
    key = view(MPC, "derived_public_key", {"path": path, "predecessor": account, "domain_id": 0}).removeprefix("secp256k1:")
    n = 0
    for c in key:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(64, "big")
    return "0x" + keccak(raw)[12:].hex()


def due(status: dict) -> str | None:
    """Why a guardian may rescue now, from the judge's own clock (a floor breach needs attested evidence)."""
    if status["mode"] not in ("active", "repairing", "repair-exhausted", "deleveraging"):
        return None
    if status["exit_requested"]:
        return "the investor asked to exit"
    if status["silent"] and status["exit_on_silence"]:
        return "the manager is silent past the investor's limit"
    return None


def strategies() -> list[dict]:
    out = []
    for e in view(FACTORY, "list_strategies", {"limit": 100}):
        try:
            st = view(e["judge"], "status")
            out.append({"judge": e["judge"], "label": e["label"], "mode": st["mode"], "rescue_due": due(st),
                        "job": st["job"], "cycle": st["cycle"] + 1, "pool_near": round(int(st["pool"]) / 1e24, 6),
                        "manager_seen_s_ago": int(time.time()) - st["last_heartbeat"] if st["manager"] else None})
        except Exception as ex:  # noqa: BLE001  one unreadable judge does not hide the others
            out.append({"judge": e["judge"], "label": e["label"], "error": str(ex)[:160]})
    return out


def inspect(judge: str) -> dict:
    """The six checks the site's inspection page runs, each with what it compared."""
    s = view(judge, "get_strategy")
    c, p = s["config"], s["config"]["policy"]
    listed = any(e["judge"] == judge for e in view(FACTORY, "list_strategies", {"limit": 100}))
    code, factory_code = code_hash(judge), view(FACTORY, "judge_code_hash")
    leg_ctrl, vault_ctrl = derived_address(judge, "keel/1/hyperevm"), derived_address(judge, "keel/1/spot")
    addr = lambda chain, to, sel: "0x" + evm.rpc(chain, "eth_call", [{"to": to, "data": sel}, "latest"])[-40:]
    leg = {"controller": addr(evm.HYPEREVM, c["leg"], "0xf77c4791"), "payout": addr(evm.HYPEREVM, c["leg"], "0x63bd1d4a")}
    vault = {"controller": addr(evm.BASE, c["spot_account"], "0xf77c4791"), "payout": addr(evm.BASE, c["spot_account"], "0x63bd1d4a")}
    inv = (c.get("investor") or "").lower()
    checks = {
        "created_by_the_factory": listed,
        "no_access_keys": keys(judge) == 0,
        "code_is_the_factorys": code == factory_code,
        "only_the_judge_controls_the_hyperliquid_account": leg["controller"].lower() == leg_ctrl.lower(),
        "only_the_judge_controls_the_base_vault": vault["controller"].lower() == vault_ctrl.lower(),
        "both_pay_only_the_investor": leg["payout"].lower() == inv and vault["payout"].lower() == inv,
    }
    return {
        "judge": judge, "passed": sum(checks.values()), "of": len(checks), "checks": checks,
        "compared": {"code": code, "factory_judge_code": factory_code, "leg": c["leg"], "vault": c["spot_account"],
                     "leg_controller": leg["controller"], "judge_key_hyperevm": leg_ctrl,
                     "vault_controller": vault["controller"], "judge_key_base": vault_ctrl, "investor": c.get("investor")},
        "mandate": {"max_leverage_x": p["max_leverage_bp"] / 1e4, "floor_usd": p["equity_floor_usd6"] / 1e6,
                    "silence_allowed_min": p["heartbeat_s"] / 60, "on_silence": p["on_silence"],
                    "reward_hyperliquid_near": round(int(p["flatten_reward"]) / 1e24, 6), "reward_base_near": round(int(p["spot_reward"]) / 1e24, 6),
                    "investor_account": c.get("investor_account"), "manager": c.get("manager")},
    }
