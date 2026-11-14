# Threat model

Who could try to cheat a Klear strategy, how, and what stops them. Each mitigation points to the test that holds it or
the live, refused transaction that shows it ([try-to-break-it.md](try-to-break-it.md) has the command to repeat each).
What you still have to trust, and what each failure would cost, is in [trust-model.md](trust-model.md).

## Assets

- **The investor's money:** the Hyperliquid account (`KeelLeg`) and the Base vault (`KeelVault`), each controlled only
  by the judge's MPC-derived key, each paying out only to the investor's immutable address.
- **The mandate:** order size, price band, leverage, the loss floor, the silence limit and the payout addresses, fixed
  in a judge with no access keys.
- **The rescue reward pool:** NEAR held by the judge, paid to a guardian per leg only once the money arrives.
- **The sealed strategy** (sealed mode only): the investor's instructions to the AI, decided inside a TEE.

## Actors and capabilities

| Actor | Can | Cannot |
|---|---|---|
| The investor | `request_exit` at any time | change the mandate, redirect funds, stop a rescue |
| The manager (an AI or a person) | `propose_order` within the mandate, `heartbeat`; the AI holds only a function-call key for those two methods | withdraw, move the Base leg, exceed size, band or leverage, trade below the floor or during an exit, guard its own strategy |
| A guardian (anyone, including another AI) | attest evidence, open a rescue once it is triggered, settle, confirm receipts | open a rescue that is not triggered, choose any order or destination, open a job on another guardian's evidence |
| A relayer (anyone) | submit what the judge signed, pay the gas | alter it: every action is EIP-712 signed and nonce-bound |
| The deployer | nothing after the lock | — |
| NEAR's MPC network, Read MPC, Hyperliquid, Base, NEAR AI Cloud | sign, attest, execute, decide (see the trust model) | — |

## Threats and mitigations

### The manager (the AI)

| Threat | Mitigation | Where |
|---|---|---|
| Takes leverage past the mandate | The judge signs only orders inside size, band and leverage | live: `mandate:leverage` (`F8beikMX…`) |
| Keeps trading after losing past the floor | Below the floor the judge refuses orders and the rescue opens to anyone | engine tests; the g7 run |
| Withdraws or moves the Base leg | The AI's key is function-call only (`propose_order`, `heartbeat`); `KeelLeg` and `KeelVault` pay only the investor | live: NEAR rejects any other method before the contract runs (`docs/results/g7/ai/attacks.md`) |
| Loses on purpose, then collects the rescue reward | The manager cannot guard its own strategy | live: `mandate:manager-cannot-guard` (`5bbAPoJT…`) |
| Leaks the investor's sealed strategy | In sealed mode the strategy is decided inside a TEE whose quote NEAR's DCAP verifier checks; a leak costs secrecy, never funds | [docs/results/sealed](results/sealed/README.md), [docs/results/tee](results/tee/README.md) |

### Strangers and guardians

| Threat | Mitigation | Where |
|---|---|---|
| Take the funds as the deployer | The judge has no access keys; its code hash is a reproducible local build | live: 0 keys after `BQ5HJE71…` |
| Send the funds anywhere but the investor | Both payouts are immutable on their chains; the judge signs nothing else that moves funds | `payout()` on `KeelLeg` and `KeelVault` |
| Trade as the manager, or keep a failing manager "alive" | `propose_order` and `heartbeat` are the manager's alone | live: `mandate:not-the-manager` (`B8aUXhfu…`, `pYG7UiSt…`) |
| Trigger the investor's emergency exit | `request_exit` is the investor's alone | live: `mandate:not-the-investor` (`F7ZC8LJV…`) |
| Force a rescue that has no reason | A rescue opens only below the floor, after the silence limit, or on the investor's request | live: `flatten-not-triggered` (`5x4Jez8V…`) |
| Steal another guardian's reward by racing its call | Only the account that attested a snapshot may open a job on it | live (`GpgYqSsa…`) |
| Feed the judge a fake world | Read MPC confirms the real, finalized log; a changed payload cannot match the judge's hash | live: "not attested" (`4gcMUUad…`) |
| Call the judge's internal callbacks | They are private | live: "Method on_attested is private" (`CpuN7S9C…`) |
| Move funds with their own signature | `KeelLeg` and `KeelVault` accept only the judge's MPC signature | live: `BadSignature()` on both |
| Get paid for a rescue that did not deliver | A leg pays only when the investor's own balance rose by what was owed; a liquidation pays nothing | engine test `a_leg_that_empties_without_arriving_pays_nothing` |
| Get paid twice, or replay old evidence | One rescue per trigger; evidence and receipts are single-use | live: `no-open-job`, `evidence-reused`, `mandate:already-rescued` |

### Infrastructure

| Threat | Mitigation |
|---|---|
| A colluding threshold of NEAR's MPC signers | This is the custody assumption; Klear adds no other key and no vendor holds one |
| Read MPC (or the RPCs its nodes query) confirms a log that never happened | Bounded: a false "below floor" only sends funds home early; a false delivery could pay one reward from the pool; the on-chain size and band checks still bound a false snapshot |
| Hyperliquid misreports through its precompiles, liquidates or auto-deleverages | Snapshots are cross-checked against the API (`make live-read`); a position change Klear never signed voids the evidence and pays nothing |
| Base stalls or a token freezes | The two legs are independent; an exit spends nothing until it succeeds |
| NEAR AI Cloud's enclave or attested model fails (sealed mode) | It can cost the strategy's secrecy, never funds: every order still goes through the judge |
| The confidential ledger's operators read balances (confidential mandate) | Disclosed: the ledger is access control, not cryptography; withdrawals reach only the investor's listed addresses |
| Our courier, drill or site disappears | Anyone can run a rescue and relay what the judge signs; the agents' MCP server is public |

## Out of scope

- A compromise of NEAR's MPC network threshold, of Intel TDX, of NEAR consensus, or of Hyperliquid or Base themselves.
- Market risk inside the mandate: an AI that trades badly within its rules loses money the rules allow it to lose.
- Mainnet operation: everything runs on testnets except two small, authorized mainnet privacy tests; nothing here is
  audited ([security-review.md](security-review.md) is internal).
