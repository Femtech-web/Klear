# A sealed strategy, live (2026-11-13)

The claim: the investor's strategy can stay secret from everyone, NEAR AI included, while every decision the AI
makes is still provably made inside attested hardware, committed on chain, and bounded by the locked judge. The
test: the deleverage strategy (`delever.keel-factory-bcf915.testnet`, judge v3.1, locked from birth) with its manager
run as

```bash
python3 agents/manager.py --strategy docs/results/delever --sealed --strategy-file .secrets/strategy.md
```

The manager's prompt, with the investor's strategy (a git-ignored file), goes end-to-end encrypted to
`z-ai/glm-5.3-flash`, a NEAR-hosted model in a TEE on NEAR AI Cloud. Before the prompt is sent, NEAR AI's own SDK
(`nearai-inference-sdk` 0.3.0) verifies the gateway's attestation and the model's: an Intel TDX quote, checked locally
with `dcap-qvl`, and NVIDIA GPU evidence. The answer is accepted only once its signature verifies against that
attested key ([`agents/keel_agents/sealed.py`](../../../agents/keel_agents/sealed.py)).

## The run

| Step | Transaction | |
|---|---|---|
| The investor rearms the strategy | [`2QSmeCiY…`](https://testnet.nearblocks.io/txns/2QSmeCiYxm8sNFTfn8WjxkHayzsJ7jYreyWtsNQhFg1u) | after the deleverage run's exit, the next cycle |
| The vault's balance, attested | [`G28jmsmn…`](https://testnet.nearblocks.io/txns/G28jmsmnPPzFEoySD9oRbvzMtDYvV9x7KPLVNtW9x186) | 0.004 WETH; 3.5 USDC on the KeelLeg |
| The manager's heartbeat and a fresh perp snapshot | [`EcfGQs5e…`](https://testnet.nearblocks.io/txns/EcfGQs5ePyF2Q3nQRKEpfFiPWHVEbj7f5Kmqxp3JYPfE), [`7ud5H7CJ…`](https://testnet.nearblocks.io/txns/7ud5H7CJAoKNLKkYh4i1var8nBmQhDz5cjoeTZumdpti) | |
| **The sealed decision: hold**, committed on chain | [`FBtEF756…`](https://testnet.nearblocks.io/txns/FBtEF756kZ4GiWpwzBiY2ixjZt9wniFce6Sojo1uDRE) | the TEE's signed receipt in the heartbeat's arguments |

The strategy's conditions were not met (the market at the time is public: ETH's mark was 1.33% under its oracle,
and funding was negative), so the AI held. A hold places no order, so its receipt goes on chain in a heartbeat; a
trade's receipt rides in `propose_order` instead. The locked judge ignores the extra field in both (tested on v3.1)
and keeps bounding every order exactly as before.

Afterwards the investor exited, with the same tools as the first time ([delever](../delever/README.md)): request
[`HWr7wXuv…`](https://testnet.nearblocks.io/txns/HWr7wXuvfZDTkgm7vZAEGzSCsX7xzV1VeFgkAWNDaiH4), rescue opened
[`DLL1n2DT…`](https://testnet.nearblocks.io/txns/DLL1n2DTrkmA2JJdqU67N8fRgnj9ddXWZtT2zDhTBf3J), the margin seen home and
0.1 NEAR paid [`GW35QuX9…`](https://testnet.nearblocks.io/txns/GW35QuX9ARQTY1ZBUWDVg9KWZp2HoMs48FwL5ZGLbBMR), the WETH
proven home and 0.05 NEAR paid [`89YdXY1Z…`](https://testnet.nearblocks.io/txns/89YdXY1ZCi6iAjE1d7UQjPL9Ea5xMktCoHJbZNqMzgcG).

## Check it yourself

```bash
python3 agents/verify_sealed.py FBtEF756kZ4GiWpwzBiY2ixjZt9wniFce6Sojo1uDRE manager.keel-delever-7953ec.testnet --attestation
```

```
heartbeat by manager.keel-delever-7953ec.testnet on delever.keel-factory-bcf915.testnet: SuccessValue
{ "model": "z-ai/glm-5.3-flash", "completion": "0d350a808b634c5ba847c75467cdfc60", "tdx": "UpToDate",
  "gpu": "verified", "gateway_tls": "attested", "prompt_sha256": "6c5a88ad…", "answer_sha256": "17f7685d…" }
signature over z-ai/glm-5.3-flash:68c7a9b6ddcc5fb677a5b… : valid (ed25519, key 5a0210f2442c7935…)
attestation now: TDX UpToDate, GPU verified, gateway TLS attested
the receipt's signing key is the attested TEE key of z-ai/glm-5.3-flash
```

The signed text is `model:sha256(request):sha256(response)` over the exact encrypted exchange. The investor's private
record holds the plaintext; its sha256 matches the receipt's `prompt_sha256` and `answer_sha256`, so the investor can
later prove what the AI was told and what it answered.

## What is private, and what is not

| | |
|---|---|
| The strategy and the AI's reasoning | **private**: encrypted to the model's attested key; not in any public log or on chain |
| That a TEE-attested model made each decision, and when | public: the signed receipt on chain |
| Each order (side, size, price) | public: the judge must check it, and Hyperliquid executes it |
| The investor's funds | bounded by the judge, as before: a TEE failure could leak the strategy, never move money |

## What this does not show

- A **sealed trade**: the market did not meet the strategy during the run. The path is the same with the receipt in
  `propose_order`.
- **Independent provenance of the model image**: the SDK reports `deployment_provenance: not_checked`; we trust NEAR
  AI's attested measurement, not a reproducible build of the model server.
- Two earlier attempts are in the record: one refused `stale-evidence` (the machine slept for six hours between the
  vault probe and its attestation, past the judge's one-hour limit), and one hold whose receipt stayed off chain,
  which led to committing holds in the heartbeat.
