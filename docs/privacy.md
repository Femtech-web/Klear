# Privacy: what is public, what could be private, and the trade-off Klear cannot escape

**Status: one mainnet demonstration, no product claim.** Everything in the Klear live runs is public: positions on
Hyperliquid, balances on Base, and the judge's state, evidence and payouts on NEAR. Separately, on mainnet, we moved
3 USDC from Hyperliquid into a Confidential Intents balance and checked what stayed public
(`docs/results/mainnet/README.md`): **the recipient and its balance were hidden; the amount in flight and the
source-chain sender were not.**

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
| **NEAR Intents Agent API** | an agent's confidential balance and routes (`confidential: true` policy) | A competitor and complement for the *mandate*: owner-signed policy with budgets, destinations, schedules, timelocks and `agent_freeze`. Its limits are enforced by the API's backend, not by a contract anyone can audit | experimental mainnet beta; partner API key |
| **NEAR AI Cloud** private inference | the AI manager's prompts, data and reasoning (TEE inference) | Strategy privacy: the manager's alpha stays private while its orders stay bounded by the judge | restored 2026-11-10 after the 2026-11-08 SGLang breach (about 100 users' details, 18 legacy agents, 2 customers' API keys in logs); the fix comes from NEAR AI's own report, with no independent audit yet |
| **OutLayer** (TDX workers on NEAR) | an agent's code, secrets and inputs, with an attestation | Same as above. Encore already verifies OutLayer TDX quotes on-chain with NEAR's DCAP verifier (Encore T1), so the AI's run could be *proven* to be the approved code | testnet available; inference would still run at the model provider unless combined with a private inference endpoint |

## Proposed architecture (not built)

1. **Strategy privacy (testnet-ready):** run the AI manager inside OutLayer and record its attested
   measurement on the judge; the judge already bounds every order, so the TEE protects only the strategy's
   secrecy, never the funds. A TEE vulnerability would leak the strategy, not move money.
2. **Post-rescue privacy (mainnet only):** set the immutable payout addresses to the investor's Confidential
   Intents deposit addresses. The rescue still pays and proves delivery on public chains; what happens after
   is confidential.
3. **A confidential mandate (mainnet only):** for money that must stay confidential end to end, use the Agent
   API's policy for limits and keep Klear only for what needs no balance: the investor's exit and the
   manager-silence exit, which would sign `agent_freeze` and a withdrawal to the fixed destination. That
   requires the judge to sign the Agent API's owner payloads, which we have not yet verified.

## Mainnet tests (authorized by the user)

**Run 2026-11-12:** the post-rescue path (Hyperliquid USDC into a confidential balance), with the result above.
The Agent API (`api.agentsonintents.com`) refuses the 1Click partner key (`401 invalid_api_key`); it needs its own
live key (`naa_…`), which the partner dashboard did not offer, so its tests have not run.
Still to do, smallest first:

Create an Agent API account with a `confidential: true`
policy whose only destination is the investor; an AI-proposed swap under a grant; `agent_freeze` by the owner;
then a Confidential Intents deposit and a check that the balance is absent from public NEAR state. Each
result goes to `docs/results/mainnet/` with what was and was not hidden.
