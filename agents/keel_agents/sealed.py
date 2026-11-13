"""Sealed decisions: the AI manager's prompt goes end-to-end encrypted to a model running in a TEE on NEAR AI
Cloud, and each answer is checked against that hardware's attestation before anything acts on it.

Only the TEE reads the strategy. What leaves this process publicly is a receipt: the TEE's signature over the
hashes of the exact (encrypted) request and response, the key that signed, the attestation's status, and the
sha256 of the plaintext prompt and answer. The investor keeps the private record (prompt, answer, reasoning) and
can later show what the AI was told and what it said; nobody else ever sees it.

Needs `pip install -r agents/requirements-sealed.txt` and NEAR_AI_CLOUD_API_KEY.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from pathlib import Path

from .chain import ROOT

from . import net  # noqa: F401  the CA bundle and DNS fallback, for the SDK's own HTTP clients too

# A NEAR-hosted open model: its weights run inside the TEE. NEAR AI's Anthropic models are proxied to Anthropic,
# so they could be verified only up to NEAR AI's gateway, never sealed.
MODEL = os.environ.get("KLEAR_SEALED_MODEL", "z-ai/glm-5.3-flash")


def api_key() -> str:
    """NEAR_AI_CLOUD_API_KEY from the environment, else from the repository's .env (git-ignored)."""
    if os.environ.get("NEAR_AI_CLOUD_API_KEY"):
        return os.environ["NEAR_AI_CLOUD_API_KEY"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("NEAR_AI_CLOUD_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("no NEAR_AI_CLOUD_API_KEY in the environment or .env")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def parse(text: str, schema: dict) -> dict:
    """The answer's JSON object, checked against the schema's required keys and enums."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"no JSON object in the answer: {text[:200]!r}")
    d = json.loads(text[start:end + 1])
    for k in schema.get("required", []):
        if k not in d:
            raise ValueError(f"the answer has no {k!r}")
    for k, spec in schema.get("properties", {}).items():
        if "enum" in spec and k in d and d[k] not in spec["enum"]:
            raise ValueError(f"{k}={d[k]!r} is not one of {spec['enum']}")
    return d


async def _ask(system: str, prompt: str, model: str):
    from nearai_inference_sdk import InferenceClient

    async with InferenceClient(api_key(), e2ee=True) as client:
        attested = await client.verify(model)  # the Gateway and the model's TDX and GPU evidence, before any prompt
        c = await client.chat.completions.create(
            model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}], temperature=0)
        verified = await client.verify_response(c.id)  # the TEE's signature over the exact bytes, against that evidence
        return c, verified, attested


def decide(role: str, system: str, prompt: str, schema: dict, log: Path, private: Path, model: str = MODEL) -> tuple[dict, dict]:
    """One sealed decision: (the decision, its public receipt). Refuses any answer not signed inside the model's TEE."""
    t0 = time.time()
    instructions = f"{system}\n\nAnswer with one JSON object only, matching this JSON schema:\n{json.dumps(schema)}"
    c, v, att = asyncio.run(_ask(instructions, prompt, model))
    if v.signature_kind != "provider_tee":
        raise RuntimeError(f"{model} answered with a {v.signature_kind} signature, not the model TEE's: not sealed")
    answer = c.choices[0].message.content or ""
    decision = parse(answer, schema)
    m = v.attestations[0]
    receipt = {
        "model": model,
        "completion": v.id,
        "signer": {"algo": v.signature.signer.signing_algo, "address": v.signature.signer.signing_address},
        "signed_text": v.signature.signed_text,
        "signature": v.signature.signature,
        "tdx": m.tcb_status,
        "gpu": m.gpu_evidence,
        "gateway_tls": att.gateway.tls_binding.kind,
        "prompt_sha256": sha256(f"{instructions}\n{prompt}"),
        "answer_sha256": sha256(answer),
    }
    private.parent.mkdir(parents=True, exist_ok=True)
    with private.open("a") as f:
        f.write(json.dumps({"at": int(t0), "role": role, "model": model, "system": instructions, "prompt": prompt,
                            "answer": answer, "receipt": receipt}) + "\n")
    public = {k: v for k, v in decision.items() if k != "reason"}  # the reasoning is the strategy: it stays sealed
    with log.open("a") as f:
        f.write(json.dumps({"at": int(t0), "role": role, "kind": "sealed", "decision": public, "receipt": receipt,
                            "seconds": round(time.time() - t0, 1)}) + "\n")
    return decision, receipt
