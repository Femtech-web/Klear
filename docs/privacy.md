# Privacy: what is public, what could be private, and the trade-off Klear cannot escape

**Status: three pieces, each checked live, none a product claim yet.** Everything in the Klear live runs is
public: positions on Hyperliquid, balances on Base, and the judge's state, evidence and payouts on NEAR. Beside it:

- **A private payout** (mainnet, 2026-11-12): 3 USDC from Hyperliquid into a Confidential Intents balance
  ([docs/results/mainnet](results/mainnet/README.md)). The recipient and its balance were hidden; the amount in
  flight and the source-chain sender were not.
- **A confidential mandate owned by no one's key** (mainnet, 2026-11-13): an Agent API account whose owner is an
  EVM key NEAR's MPC network derives, with Klear's mandate as its confidential policy; creation, a grant, a freeze
  and an unfreeze all signed by the MPC network. Funded with 3 USDC: a sealed AI swapped 1 USDC for NEAR inside the
  confidential balance, a withdrawal to a stranger was refused, then the owner revoked the AI's grant and everything
  went home to the user ([docs/results/mandate](results/mandate/README.md)).
- **A sealed strategy** (testnet, 2026-11-13): the AI manager's prompt, with the investor's strategy, end-to-end
  encrypted to a model in a TEE on NEAR AI Cloud; each answer verified against Intel TDX and NVIDIA GPU attestation
  before it is used; its signed receipt committed on chain with the decision, and checkable by anyone with
  `agents/verify_sealed.py` ([docs/results/sealed](results/sealed/README.md)). The live decision was a hold. NEAR
  verifies it too: a locked registry had NEAR's DCAP verifier prove the model's TDX quote and checked the receipt's
  signature with NEAR's ed25519 ([docs/results/tee](results/tee/README.md)).

## The tension

Klear's protections rest on **public, attested balances**: the floor, the leverage cap and the proof of
delivery are all checked against logs that NEAR's Read MPC confirms on a public chain. A **confidential**
balance cannot be attested that way, by definition. So no design gets both from the same account:

| Where the money sits | What Klear can enforce |
|---|---|
| Public accounts (KeelLeg, KeelVault) | everything: mandate, floor, leverage, delivery-verified rescue |
| A confidential balance | only what needs no balance: the investor's own exit request, the manager-silence trigger, and fixed destinations. No floor, no leverage cap, no proof of delivery |

## What we researched (2026-11-12)

| Option | What it hides | Fit for Klear | Status |
|---|---|---|---|
| **NEAR Confidential Intents** (1Click API) | balances and transfers held on the confidential ledger (`intents.far`), which are not visible on the public NEAR chain | A rescue's *destination*: the investor's payout could be a confidential deposit address, so what they hold and do after a rescue is private (the deposit itself stays public on its source chain) | GA since 2026-07-07; mainnet only; needs a Partner JWT and a NEP-413 user session |
| **NEAR Intents Agent API** | an agent's confidential balance and routes (`confidential: true` policy) | A competitor and complement for the *mandate*: owner-signed policy with budgets, destinations, schedules, timelocks and `agent_freeze`. Its limits are enforced by the API's backend, not by a contract anyone can audit | experimental mainnet beta; tested 2026-11-13 with an MPC-derived owner ([docs/results/mandate](results/mandate/README.md)) |
| **NEAR AI Cloud** private inference | the AI manager's prompts, data and reasoning (TEE inference) | Strategy privacy: the manager's alpha stays private while its orders stay bounded by the judge. **Chosen**: E2EE to NEAR-hosted open models (its Anthropic models are proxied, so not sealed) | restored 2026-11-10 after the 2026-11-08 SGLang breach (about 100 users' details, 18 legacy agents, 2 customers' API keys in logs); the fix comes from NEAR AI's own report, with no independent audit yet |
| **OutLayer** (TDX workers on NEAR) | an agent's code, secrets and inputs, with an attestation | Same as above. Encore already verifies OutLayer TDX quotes on-chain with NEAR's DCAP verifier (Encore T1), so the AI's run could be *proven* to be the approved code | testnet available; inference would still run at the model provider unless combined with a private inference endpoint |

## The architecture

1. **A sealed strategy (built).** The manager runs `agents/manager.py --sealed --strategy-file <private file>`.
   Its prompt, with the investor's strategy, is encrypted to a model key attested inside the TEE (NEAR AI Cloud's
   E2EE), so not even NEAR AI's gateway reads it. The answer counts only after its signature verifies against the
   model's attestation (Intel TDX quote through `dcap-qvl`, NVIDIA GPU evidence). The order the manager proposes
   carries a receipt in its arguments (a hold, which places no order, carries it in the manager's heartbeat): the
   TEE's signature over the hashes of the exact encrypted exchange, the signing key, the attestation status, and
   the sha256 of the plaintext prompt and answer. The judge ignores it
   (its view of extra fields was tested on the locked v3.1 judge) and bounds the order as any other; the receipt
   stays on chain beside it. The plaintext stays in the investor's git-ignored record, so the investor can later
   show what the AI was told. A TEE failure would leak the strategy, never move money.
2. **Post-rescue privacy (mainnet only):** set the immutable payout addresses to the investor's Confidential
   Intents deposit addresses. The rescue still pays and proves delivery on public chains; what happens after
   is confidential.
3. **A confidential mandate (mainnet only, partly built).** The Agent API holds the money confidentially and
   enforces the policy; the owner is an MPC-derived key, so no person can loosen it. Tested: every owner action
   signed by the MPC network. Found: policy changes carry the policy encrypted to OutLayer, so a contract cannot
   check what it approves (a freeze carries an encrypted policy update too). Built: `contracts/klear-owner`, a
   locked owner that signs anything only during setup, for the investor, then only grant revocations and grants
   (plaintext payloads it checks: this agent, mainnet, this owner), and only on the investor's exit or the
   manager's silence ([docs/results/owner](results/owner/README.md)).

## Mainnet tests (authorized by the user)

**Run 2026-11-12:** the post-rescue path (Hyperliquid USDC into a confidential balance), with the result above.

**Run 2026-11-13:** the confidential mandate, on the hackathon's Agent API deployment
(`api.demo.agentsonintents.com`, mainnet; the 1Click partner key is refused there, and its own key comes from
`partners.demo.agentsonintents.com`). Done: the account, its policy, a grant, a freeze and an unfreeze, the
policy's refusals; then, funded with 3 USDC, a sealed AI's swap under its grant, a live refusal, and the exit home.
