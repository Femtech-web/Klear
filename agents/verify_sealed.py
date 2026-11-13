"""Check a sealed decision from the chain alone.

    python3 agents/verify_sealed.py <tx-hash> <sender-account> [--attestation]

A sealed manager (agents/keel_agents/sealed.py) puts a receipt in the arguments of its `propose_order` (a trade) or
`heartbeat` (a hold). This reads that receipt from the NEAR transaction and verifies the TEE's signature over its
`signed_text` (model:sha256(request):sha256(response)) against the signing key in the receipt. With --attestation
(needs agents/requirements-sealed.txt), it also fetches the model's attestation from NEAR AI Cloud now, verifies its
Intel TDX quote and GPU evidence, and checks that the signing key is that TEE's. A deployment that has since
rotated its key fails this second check without the receipt being wrong.
"""
from __future__ import annotations

import base64
import json
import sys

from keel_agents.net import post_json

RPC = "https://test.rpc.fastnear.com"


def receipt(tx: str, sender: str) -> tuple[dict, dict]:
    r = post_json(RPC, {"jsonrpc": "2.0", "id": 1, "method": "tx",
                        "params": {"tx_hash": tx, "sender_account_id": sender, "wait_until": "FINAL"}})
    if "result" not in r:
        sys.exit(f"transaction not found: {json.dumps(r.get('error'))[:300]}")
    t = r["result"]["transaction"]
    call = t["actions"][0]["FunctionCall"]
    args = json.loads(base64.b64decode(call["args"]))
    if "sealed" not in args:
        sys.exit(f"{call['method_name']} on {t['receiver_id']} carries no sealed receipt")
    return {"signer": t["signer_id"], "judge": t["receiver_id"], "method": call["method_name"],
            "status": next(iter(r["result"]["status"]))}, args["sealed"]


def signer_key(s: dict) -> str:
    return s["signer"].get("address") or s["signer"]["key"]  # "key" in the first receipts


def verify_signature(s: dict) -> None:
    algo, key = s["signer"]["algo"], signer_key(s)
    if algo == "ed25519":
        import nacl.signing

        nacl.signing.VerifyKey(bytes.fromhex(key.removeprefix("0x"))).verify(s["signed_text"].encode(), bytes.fromhex(s["signature"].removeprefix("0x")))
    else:
        from eth_account import Account
        from eth_account.messages import encode_defunct

        if Account.recover_message(encode_defunct(text=s["signed_text"]), signature=s["signature"]).lower() != key.lower():
            raise ValueError("the signature does not recover to the signer")


def verify_attestation(s: dict) -> None:
    import asyncio

    from nearai_inference_sdk import InferenceClient

    from keel_agents import sealed

    async def check():
        async with InferenceClient(sealed.api_key(), e2ee=False) as client:
            return await client.verify(s["model"])

    att = asyncio.run(check())
    keys = {m.signer.signing_address.lower().removeprefix("0x") for m in att.models}
    m = att.models[0]
    print(f"attestation now: TDX {m.tcb_status}, GPU {m.gpu_evidence}, gateway TLS {att.gateway.tls_binding.kind}")
    if signer_key(s).lower().removeprefix("0x") not in keys:
        raise ValueError("the receipt's key is not among the model's attested keys now (rotated, or not this TEE)")
    print("the receipt's signing key is the attested TEE key of", s["model"])


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    where, s = receipt(sys.argv[1], sys.argv[2])
    print(f"{where['method']} by {where['signer']} on {where['judge']}: {where['status']}")
    print(json.dumps({k: s[k] for k in ("model", "completion", "tdx", "gpu", "gateway_tls", "prompt_sha256", "answer_sha256")}, indent=1))
    verify_signature(s)
    print(f"signature over {s['signed_text'][:40]}… : valid ({s['signer']['algo']}, key {signer_key(s)[:16]}…)")
    if "--attestation" in sys.argv:
        verify_attestation(s)


if __name__ == "__main__":
    main()
