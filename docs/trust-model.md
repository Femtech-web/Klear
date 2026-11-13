# Trust model

"The judge has no keys" means nobody can change its code or its mandate. It does **not** mean nobody can
affect the funds. This is everything a Klear strategy relies on, what each failure would cost, and how to
check each claim yourself.

## Who can do what

| Party | Can | Cannot |
|---|---|---|
| Investor (NEAR account in the config) | `request_exit` at any time | change the mandate, redirect funds (both payouts are immutable on their chains), stop a rescue |
| Manager (AI or person) | `propose_order` (signed only within the mandate), `heartbeat` | withdraw, move the Base leg, exceed size/band/leverage, trade below the floor or during an exit, guard its own strategy |
| Guardian (anyone) | attest evidence, open an exit once it is triggered, settle, confirm receipts | open an exit that is not triggered, choose any order parameter, send funds anywhere but the payouts, open a job on another guardian's evidence |
| Relayer (anyone) | submit what the judge signed, pay gas | alter it (every action is EIP-712 signed and nonce-bound) |
| Deployer | nothing after the lock | — |

In the live G7 run the AI process holds only a NEAR function-call key whose on-chain permission is
`receiver: <judge>, methods: [propose_order, heartbeat], allowance: 0.5 NEAR` (`docs/results/g7/ai/ai-keys.txt`).

## What you are trusting

| Component | If it fails or lies | Bound |
|---|---|---|
| **NEAR Chain Signatures MPC** (`v1.signer-prod.testnet`) | A colluding signing threshold could sign anything for the judge's derived keys, so it could take the funds. If it stops, nothing is signed: no trades, and no rescue until it returns | This is the custody assumption; Klear adds no other key. No vendor or TEE holds a key |
| **Read MPC** (`verify_foreign_transaction`, Finalized) | A colluding threshold, or the RPC providers its nodes query, could confirm a log that never happened | A false "below floor" only sends funds to the investor early. A false delivery could pay a guardian for nothing (bounded by the reward pool). A false snapshot could let one manager order through that the on-chain KeelLeg band and size checks still bound |
| **Judge code** (keel-core + near-keel) | A bug could sign something the rules meant to refuse | 98 local tests; the wasm hash is reproducible from source (`be140d65…`). **Not audited** |
| **KeelLeg / KeelVault** | A bug could misroute an action | The only outflows are to immutable payouts; 39 Foundry tests. **Not audited** |
| **Hyperliquid** (HyperCore, precompiles, CoreWriter) | Wrong precompile data misleads every decision; the exchange can liquidate or ADL | Snapshots are cross-checked against the API in `make live-read`; liquidation shows up as a position change Klear never signed (voided, never paid) |
| **Base** (sequencer, WETH contract) | Liveness delays the spot leg; a frozen token blocks it | The legs are independent; the exit spends nothing until it succeeds |
| **NEAR AI Cloud's TEE** (sealed strategy only) | A flaw in the enclave or in the attested model image could leak the investor's strategy, or an attested model could answer badly | The SDK checks the Intel TDX quote, the NVIDIA GPU evidence and the gateway's TLS binding before each decision, and NEAR's DCAP verifier checks the quote on chain (`klear-tee`); it can cost strategy secrecy, never funds: every order still goes through the judge. The model image's provenance is NEAR AI's attested measurement, not a build we reproduced |
| **NEAR Intents' confidential ledger and the Agent API** (confidential mandate only) | The ledger is access control, not cryptography: its operators and Defuse can read balances, and 1Click's solvers see each intent; the account's policy is enforced by the API's backend and OutLayer, not by a Klear contract | Withdrawals reach only the investor's listed addresses; the owner key is held only by NEAR's MPC network |
| **NEAR itself** | If it halts, nothing happens; the strategy fails closed for trading and stalls the rescue | — |

## What is checkable, and how

| Claim | Check |
|---|---|
| Nobody controls the judge | `view_access_key_list` on the judge returns no keys (lock txs: AI `BQ5HJE71…`, human `5TCwTXvA…`); `view_code` hash equals a local `make judge` build |
| Only the judge can act for the Hyperliquid account | `KeelLeg.controller()` equals the address of the MPC key derived for `(judge, "keel/1/hyperevm")` |
| Only the judge can move the Base leg | `KeelVault.controller()` equals the MPC address for `(judge, "keel/1/spot")` |
| Both legs can only pay the investor | `KeelLeg.payout()` and `KeelVault.payout()` are immutable and equal the investor's address |
| A sealed decision came from an attested TEE, and is the one on chain | `python3 agents/verify_sealed.py <tx> <sender> --attestation` reads the receipt from the manager's transaction, verifies the TEE's signature, and checks its key against the model's attestation |
| The AI holds no unrestricted key | the manager account's key list: the AI's key is FunctionCall-only (above) |
| A guardian is paid only for delivery | the judge's `payouts` list names each leg; each `Delivery` cites the attested log that proves it |

## Bypass attempts

Each of these is a test (`crates/keel-core/tests/engine.rs`, `contracts/near-keel/src/lib.rs`,
`contracts/evm/test/*`). The live run repeats the ones that matter on testnet (see `docs/results/g7/`).

- A stranger, the manager or the deployer calls `request_exit`: `mandate:not-the-investor`.
- A non-manager proposes or sends a heartbeat: `mandate:not-the-manager`.
- The manager tries to be the guardian: `mandate:manager-cannot-guard`.
- A guardian opens a job on evidence another account attested: refused by the judge.
- An exit with no trigger: `flatten-not-triggered`.
- Re-used evidence, a second receipt for the same nonce, settling a finished rescue: `evidence-reused`,
  `unknown-signed-action`, `no-open-job`.
- A receipt that pays someone else, names another token, comes from another vault or chain, or moves
  nothing: `bad-evidence`.
- A forged or mismatched Read MPC answer: not stored (the payload hash must match the judge's own).
- A tampered, replayed, expired, malleable or other-chain signature on KeelLeg or KeelVault: reverts.
