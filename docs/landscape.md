# Landscape: who already does what

Bounding what a manager or an agent may do is **not** new, and Keel does not claim it is. The table shows
where each comparable system stops. Facts are from each project's public docs as of 2026-11-12; items we
could not verify are marked.

| System | Bounds the manager before it acts | Exit without the manager | Proof the investor got the money | Venues |
|---|---|---|---|---|
| **Keel** | yes: size, band, leverage on attested liquidation value, floor | yes: anyone, on a verified trigger (floor, investor request, chosen manager-silence) | yes: the reward is paid per leg only on attested arrival (vault receipt; payout's HyperCore balance) | Hyperliquid perp + Base, judged on NEAR |
| Hyperliquid vaults | no: the leader trades freely | each depositor withdraws for themselves (after a lockup, and possibly delayed while positions are open); the leader cannot take deposits | n/a (one venue) | Hyperliquid |
| Enzyme | yes: asset and adapter whitelists, disallowed assets, redemption rules (no leverage policy found) | investors redeem themselves | n/a (one chain) | EVM |
| Zodiac Roles (Safe) | yes: per-function, per-argument permissions for an address (used for AI agents) | the Safe's owners | n/a | EVM |
| Turnkey | yes: a policy engine checks each signing request | key holders | n/a | many (signing layer) |
| Newton Protocol | yes: policies checked before a transaction executes | not a goal | n/a | EVM |
| NEAR Intents Agent API | yes: budgets, per-asset limits, destinations, schedules, timelocks, `agent_freeze`; confidential balances | the owner freezes or withdraws | n/a | NEAR Intents (mainnet beta) |
| DeFi Saver | automation: stop-loss and leverage management on lending positions | yes, if the user set it up | n/a | single protocol positions |
| Morpho Vault V2 | curators within caps | in-kind redemption / `forceDeallocate` | n/a | one chain |
| DLTX | execution key only | exit after a 7-day stop (not verified live) | n/a | Hyperliquid |
| Index Coop FLI `ripcord` | — | anyone, paid on call (atomic venue) | not needed when atomic | one chain |
| "Mandate" projects (Saber1Y/Mandate on BOT Chain, mandates.ai, the ERC spend-mandate proposal, AP2 mandates) | spend or payment mandates for agents | not the focus | n/a | various |
| Hackathon peers (near-sentinel, Checkpoint__V2, NEARFirewall) | agent safety / spending controls on NEAR | not seen | not seen | NEAR |

## Where Keel is different

1. **The rescue pays on proof of delivery, across an asynchronous venue and an L2.** Every exit in the table
   either relies on each user acting alone, or pays on the call itself (sound only when execution is atomic).
   On Hyperliquid, submission is not execution; Keel pays only when a later attested snapshot shows the USDC
   at the investor's address and a Base receipt shows the asset arrived.
2. **The trigger is the investor's choice and is verified.** A floor on cross-chain liquidation value, the
   investor's own request, or a manager silent past a heartbeat window the investor opted into.
3. **No vendor holds a key.** Signing is NEAR's MPC network for a contract with no keys; evidence is NEAR's
   Read MPC. The trade-off is documented in `docs/trust-model.md`.

## Where others are ahead

- Enzyme, Zodiac Roles and Turnkey are audited, in production, and far broader in what they can express.
- The Agent API offers confidentiality Keel does not (`docs/privacy.md`).
- Hyperliquid vaults have real liquidity and users; Keel is a testnet system and **not audited**.
