# Try to break it

Klear's claims are only worth what survives people trying to break them. The live judges below are **locked**
(no access keys) and hold real testnet funds, so every attempt here is a real transaction against the real
thing. If any of these succeeds, that is a bug: please open an issue with the transaction.

| Live target | Address |
|---|---|
| AI judge (an AI manager, an AI guardian) | `keel-ai-76e036.testnet` |
| Human judge (the investor's own exit) | `keel-human-c0caa7.testnet` |
| Their Hyperliquid accounts (KeelLeg v6, HyperEVM 998) | `0x58675f5d6b9dd6394bD635b92Be9341B44F136DA`, `0x03bCCE19De27Fd9520c38427F60ed305073A3f51` |
| Their Base accounts (KeelVault, Base Sepolia) | `0x9AB31b03dDa4e1F08cD2f2fC8a1FFA69a5D7Cd0c`, `0x2403529Abe0d3adaFAA630173275Fd5b53a9A13f` |
| The investor (both payouts, both chains) | `0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4` |

You need a NEAR testnet account (free from the faucet) and, for the EVM attempts, nothing but `cast`. Set
`J=keel-ai-76e036.testnet` and `ME=<your-account>.testnet`.

## The challenges

| # | Try to… | How | What should happen | What happened when we tried (live) |
|---|---|---|---|---|
| 1 | Take the funds as the deployer | Look for a key: `near account list-keys $J network-config testnet now` | No keys: nobody can deploy new code, call as the judge, or change the mandate | 0 keys after `BQ5HJE71…`; code hash = a local build (`docs/results/g7/code-hashes.txt`) |
| 2 | Send the funds anywhere but the investor | Read `payout()` on KeelLeg and KeelVault | Both are immutable and equal the investor; the judge signs nothing else that moves funds | Both checked after deployment (`docs/results/g7/ai/evm.txt`) |
| 3 | Trade as the manager | `near contract call-function as-transaction $J propose_order json-args '{…}' … sign-as $ME` | `mandate:not-the-manager` | `B8aUXhfu…` |
| 4 | Trigger the investor's emergency exit | `… request_exit json-args '{}' … sign-as $ME` | `mandate:not-the-investor` | `F7ZC8LJV…` |
| 5 | Keep a failing manager "alive" | `… heartbeat …` from your account | `mandate:not-the-manager` | `pYG7UiSt…` |
| 6 | Force an exit that has no reason | Attest a snapshot, then `open_flatten` while value is above the floor, the manager is heard from, and the investor has not asked | `flatten-not-triggered` | `5x4Jez8V…` |
| 7 | Steal a guardian's reward by racing its call | `open_flatten` with a snapshot another account attested | "only the account that attested this evidence may open a job on it" | `GpgYqSsa…` |
| 8 | Lose money on purpose as the manager, then collect the rescue reward | `open_flatten` from the manager's account, even on evidence it attested itself | `mandate:manager-cannot-guard` | `5bbAPoJT…` |
| 9 | Use the AI's key for anything but trading | Sign `open_flatten` or `request_exit` with the AI's function-call key | Rejected by NEAR itself before the contract runs: "method name … isn't allowed by the access key" | `docs/results/g7/ai/attacks.md` |
| 10 | Feed the judge a fake world | Take a real, finalized KeelLeg log, change its account value to 1,000,000 USD, call `attest` | Read MPC confirms the real log, not yours: the payload hash cannot match and nothing is stored | `4gcMUUad…` (judge log "not attested", `get_attested` = null) |
| 11 | Call the judge's internal callbacks | `… on_attested json-args '{…}' …` | "Method on_attested is private" | `CpuN7S9C…` |
| 12 | Move funds with your own signature | Relay an order to KeelLeg or an exit to KeelVault signed by any key but the judge's | Reverts `BadSignature()` (`0x5cd5d233`) | both, `docs/results/g7/ai/attacks.md` |
| 13 | Over-leverage as the manager | Propose an order that takes leverage past the mandate | `mandate:leverage` | `F8beikMX…` |
| 14 | Get paid for a rescue that did not deliver | Settle when the leg is empty but the investor's balance did not rise (a liquidation) | No reward: the leg is `unverified` or `empty` | engine tests `a_leg_that_empties_without_arriving_pays_nothing` |
| 15 | Get paid twice | Settle again, confirm the same receipt again, open a second rescue | `no-open-job`, `evidence-reused`, `mandate:already-rescued` | `GRxMc5xs…`, `3GfZcKUt…`, `AyebfDKK…` |
| 16 | Replay old evidence | Cite a snapshot or receipt the judge already used | `evidence-reused` | engine and contract tests |

## Where it is honestly weaker

Breaking these needs more than a clever transaction, and we say so in `docs/trust-model.md`:
- a colluding threshold of NEAR's MPC signers;
- a colluding threshold of Read MPC nodes (or the RPC providers they query);
- a bug in code that is **not audited**.

Each would still be bounded: the payouts are immutable, and Read MPC lies could at worst pay a reward or
trigger an early exit to the investor.

## Locally

`make test` runs all of the above as tests: 98 of them across Rust, Foundry (with a simulated HyperCore), the
end-to-end loop through the real judge, and the NEAR contract.
