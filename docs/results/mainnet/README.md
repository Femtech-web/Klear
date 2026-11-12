# Mainnet: a rescued-funds path into a Confidential Intents balance (2026-11-12)

Authorized by the user, funded by the user (3 USDC from their own Hyperliquid account). One real swap through
NEAR Intents' 1Click API with `confidentiality: "basic"`: USDC on HyperCore into a **confidential** USDC balance on
NEAR Intents, owned by Keel's test account `143fa266…c87c` (its key is in `.secrets/near-mainnet/`).

## What happened

| Step | Evidence |
|---|---|
| Partner key works; a signed **dry** quote: 0.002 Base ETH into confidential USDC | `quote-dry-base-eth-to-confidential-usdc.json` |
| A real quote: 3 USDC from HyperCore spot into the test account's confidential USDC | `quote-real-hypercore-usdc-*.json`; deposit address `0x58BD4af609Db791bBc35e122aD26C787E140cb1d` |
| The user sends 3.0 USDC (Spot to Spot); Hyperliquid charges its 1 USDC new-account fee **on top** | the user's ledger: `send … amount 3.0, fee 1.0, sourceDex spot, destinationDex spot`, hash `0xde036a45…8767b` |
| 1Click: `SUCCESS`, 2.8 in, **2.799671 USDC out**, slippage 0, no destination-chain transaction | `watch.log`; intent `HtSCPtCs…`; NEAR txs `91iEGtJY…` (bridge in), `42xAs6Ts…` (`execute_intents`) |
| The owner's session (NEP-413, versioned nonce) reads its **confidential** balance | `confidential-balances-*.json`: `2799671` of `nep141:17208628…`, `source: private` |
| The same account on **public** `intents.near` | `mt_balance_of` = `"0"` |

## What is and is not hidden (checked, not assumed)

| | Public? |
|---|---|
| The sender and amount on the origin chain (the HyperCore send to a 1Click deposit address) | **yes** |
| The amount moving through NEAR (`2800000` appears in both public NEAR transactions) | **yes** |
| **Which account received it** (the test account appears in neither public NEAR transaction) | **no** |
| **What that account holds afterwards** (public `intents.near` reports 0) | **no** |

So Confidential Intents, as exercised here, hides the **recipient and its balance**, not the amount in flight or
the sender on the source chain. For Keel this fits the post-rescue design in `docs/privacy.md`: a rescue's payout
can land in a balance that no public reader can attribute to the investor, while the rescue itself stays fully
verifiable on public chains.

## The funds

2.799671 USDC sit in the test account's confidential balance. They can be withdrawn to the user's address with a
withdrawal intent signed by that account's key (a small fee applies). Nothing else was moved on mainnet.
