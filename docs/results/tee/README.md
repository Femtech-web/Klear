# A sealed decision, verified on NEAR (2026-11-13)

The claim: a sealed AI decision is not just checkable off chain; NEAR itself verifies the hardware that made it and
the signature on it. The contract: [`contracts/klear-tee`](../../../contracts/klear-tee) at
`klear-tee-4746e3.testnet`, deployed and then locked (0 access keys; wasm sha256 `ae056966…`, [code-hash.txt](code-hash.txt)).
Run with [`scripts/testnet/tee.py`](../../../scripts/testnet/tee.py); every call is in [run.jsonl](run.jsonl).

| Step | Transaction | Result |
|---|---|---|
| Deploy, then lock | [`3GCMdQRY…`](https://testnet.nearblocks.io/txns/3GCMdQRY4MvWp437jvxeZmnwhqdVHptPYLGppGf6788x), [`4NjSvuu1…`](https://testnet.nearblocks.io/txns/4NjSvuu1exhy336skzowH1HQLsWEwAyTygsZRGBBzuKR) | its only key deleted |
| **Prove the model's signing key**: NEAR AI Cloud's attestation for `z-ai/glm-5.3-flash`, requested with a fresh nonce; its Intel TDX quote and Intel's collateral go to NEAR's DCAP verifier (`tee-verifier-2026-07-22.testnet`) | [`G1JbmpNR…`](https://testnet.nearblocks.io/txns/G1JbmpNRoXTjBV6V2nQSz5E7doJAyFhBD3vEkcLhzXY2) | **"signer 5a0210f2… of z-ai/glm-5.3-flash proven on NEAR: TDX UpToDate"**: the verifier accepted the quote, and the contract checked that its report_data is exactly the key followed by the nonce, with debug off |
| **Verify the sealed hold's receipt** (the manager's heartbeat [`FBtEF756…`](../sealed/README.md)) | [`YJ3JvkHU…`](https://testnet.nearblocks.io/txns/YJ3JvkHU9973GuUi6B2jw4J2nWjY8RNmN4H5KR2GWVA) | recorded as verified: NEAR's `ed25519_verify` checked the TEE's signature over `model:sha256(request):sha256(response)` against the proven key |
| **Verify a sealed trade's receipt** (the filled buy in agent run 4, `9kZdLCQN…`) | [`FQWtDbwk…`](https://testnet.nearblocks.io/txns/FQWtDbwkHFMfBnxv5U8hA6M9bj19xdmGbWX6u4CFQc45) | recorded as verified |
| The same receipt with one character of its text changed | [`7g1XUBgJ…`](https://testnet.nearblocks.io/txns/7g1XUBgJhcBN3YTmceoeynhNw5vnXsbosJo9Yb1Vwpcw) | **refused `signature does not verify`** |

## Check it yourself

```bash
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"klear-tee-4746e3.testnet","method_name":"get_signers","args_base64":"e30="}}' \
  | python3 -c 'import json,sys;print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

It lists the proven key with its TCB status and its TD measurements (MRTD, RTMR0 to RTMR3). The local half,
`tee.py prove`, runs the same verifier code (dcap-qvl) first, and sends nothing unless the quote passes.

## What it does and does not show

- **Shown:** a key that signs sealed decisions belongs to a TDX enclave Intel's collateral vouches for, as NEAR's
  own DCAP verifier decided; and a receipt is that key's signature, as NEAR's ed25519 host function decided.
- **Not shown:** that the measured image is NEAR AI's published model server. The contract records the
  measurements; comparing them to NEAR AI's published values is off chain, and we have not reproduced that build.
  NVIDIA GPU evidence is checked off chain only (by NEAR AI's SDK), not on NEAR.
- **Not enforced by the judge.** The locked v3.1 judges ignore receipts; a future judge could require a receipt
  proven here before it signs an order.
