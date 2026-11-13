"""Klear's TEE registry on testnet (contracts/klear-tee): a sealed decision checked on NEAR, not just off chain.

    python3 scripts/testnet/tee.py prove [model]          fetch the model's attestation with a fresh nonce, check it
                                                          locally, then have NEAR's DCAP verifier prove its signing key
    python3 scripts/testnet/tee.py verify <tx> <sender>   read a sealed receipt from a manager's transaction and have
                                                          the registry check its signature on chain
    python3 scripts/testnet/tee.py status

Reads TEE_REGISTRY from docs/results/tee/env and NEAR_AI_CLOUD_API_KEY from .env (never printed). Every call is
recorded in docs/results/tee/.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agents"))

import dcap_qvl  # noqa: E402

from keel_agents import registry, sealed  # noqa: E402
from keel_agents.net import _CTX  # noqa: E402

OUT = ROOT / "docs" / "results" / "tee"
NEAR = str(ROOT / "node_modules" / ".bin" / "near")
STATE = dict(l.split("=", 1) for l in (OUT / "env").read_text().split() if "=" in l)
TEE = STATE["TEE_REGISTRY"]
CALLER = STATE["TEE_CALLER"]


def note(kind: str, **fields) -> None:
    with (OUT / "run.jsonl").open("a") as f:
        f.write(json.dumps({"at": int(time.time()), "kind": kind, **fields}) + "\n")
    print(f"{kind}: {json.dumps(fields)[:300]}")


def call(method: str, args: dict, gas: str = "300.0 Tgas") -> tuple[str | None, str]:
    out = OUT / f"{method}-{int(time.time())}.txt"
    with out.open("w") as f:
        subprocess.run([NEAR, "contract", "call-function", "as-transaction", TEE, method, "json-args", json.dumps(args), "prepaid-gas", gas,
                        "attached-deposit", "0 NEAR", "sign-as", CALLER, "network-config", "testnet", "sign-with-access-key-file",
                        str(ROOT / ".secrets" / "near" / f"{CALLER}.json"), "send"], stdout=f, stderr=subprocess.STDOUT, cwd=ROOT, timeout=300)
    text = re.sub(r"\x1b\[[0-9;]*m", "", out.read_text())
    tx = re.search(r"Transaction ID: ([A-Za-z0-9]+)", text)
    return (tx.group(1) if tx else None), text


def borsh(b: bytes) -> bytes:
    return len(b).to_bytes(4, "little") + b


def collateral_args(c) -> bytes:
    """Intel's collateral as NEAR's DCAP verifier takes it: dcap-qvl's QuoteCollateralV3 fields in order, then no PCK chain."""
    out = b""
    for f in ("pck_crl_issuer_chain", "root_ca_crl", "pck_crl", "tcb_info_issuer_chain", "tcb_info", "tcb_info_signature",
              "qe_identity_issuer_chain", "qe_identity", "qe_identity_signature"):
        v = getattr(c, f)
        out += borsh(v.encode() if isinstance(v, str) else bytes(v))
    return out + b"\x00"


def prove(model: str) -> None:
    nonce = secrets.token_hex(32)
    url = f"https://cloud-api.near.ai/v1/attestation/report?model={urllib.parse.quote(model, safe='')}&nonce={nonce}&signing_algo=ed25519"
    req = urllib.request.Request(url, headers={"authorization": f"Bearer {sealed.api_key()}", "user-agent": "klear/0.1"})
    report = json.load(urllib.request.urlopen(req, timeout=60, context=_CTX))
    m = report["model_attestations"][0]
    key = m["signing_address"].lower().removeprefix("0x")
    quote = bytes.fromhex(m["intel_quote"])

    async def fetch():
        return await dcap_qvl.get_collateral(dcap_qvl.INTEL_PCS_URL, quote)

    c = asyncio.run(fetch())
    # Locally first: the same verifier code, so only a quote that passes goes on chain.
    local = dcap_qvl.verify(quote, c, int(time.time()))
    report_data = bytes(dcap_qvl.parse_quote(quote).report.report_data)
    bound = report_data == bytes.fromhex(key) + bytes.fromhex(nonce)
    note("attestation", model=model, signer=key, nonce=nonce, echoed_nonce=m.get("request_nonce") == nonce, local_tcb=local.status,
         report_data_binds_key_and_nonce=bound)
    if local.status != "UpToDate" or not bound:
        sys.exit("the quote did not pass locally; nothing sent")
    (OUT / f"quote-{key[:12]}.hex").write_text(m["intel_quote"])
    tx, text = call("prove_signer", {"model": model, "signing_key": key, "nonce": nonce, "quote": base64.b64encode(quote).decode(),
                                      "collateral": base64.b64encode(collateral_args(c)).decode()})
    logs = re.findall(r"signer \S+ (?:of \S+ proven on NEAR: TDX \w+|not proven: [^\n]+)", text)
    note("prove_signer", tx=tx, signer=key, result=logs[-1] if logs else None, onchain=registry.view(TEE, "get_signer", {"signing_key": key}))


def verify(tx: str, sender: str) -> None:
    import verify_sealed

    _, s = verify_sealed.receipt(tx, sender)
    key = s["signer"].get("address") or s["signer"]["key"]
    vtx, text = call("verify_receipt", {"signed_text": s["signed_text"], "signature": s["signature"], "signing_key": key}, "30.0 Tgas")
    refused = re.search(r"Smart contract panicked: ([^\n\"]+)", text)
    note("verify_receipt", receipt_tx=tx, tx=vtx, refused=refused and refused.group(1),
         onchain=registry.view(TEE, "get_receipt", {"signed_text": s["signed_text"]}))


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "prove":
        prove(sys.argv[2] if len(sys.argv) > 2 else sealed.MODEL)
    elif cmd == "verify":
        verify(sys.argv[2], sys.argv[3])
    else:
        print(json.dumps({"registry": TEE, "stats": registry.view(TEE, "stats"), "signers": registry.view(TEE, "get_signers")}, indent=1))


if __name__ == "__main__":
    main()
