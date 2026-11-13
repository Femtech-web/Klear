# Klear-0: feasibility and decision (2026-11-12)

## Decision

**Klear works end to end on real testnets, including the on-chain payout.**
- **Real-network gate (2026-11-12):** G1–G4 passed. G5 (Base) passed for attestation; the Base spot leg inside the paid loop still needs Base Sepolia gas. See [Real-network results](#real-network-results-2026-11-12).
- **Recommendation:** build it as a hackathon entry, framed as "pay-on-proof keepers for asynchronous venues". Before submission: lock the judge account, put the spot leg on Base, and record the demo.
- **Confidential Klear (B):** rejected. Build Standard Klear (A), and make no privacy claims.

### What is actually distinct

Permissionless bounded repair with a keeper reward is **not** new.
- Index Coop's FLI `ripcord()` (verified in `FlexibleLeverageStrategyExtension.sol`):
  - anyone (EOA-only) may call it when leverage passes a threshold;
  - it is bounded by `incentivizedSlippageTolerance`, a max trade size and a cooldown;
  - it pays `etherReward` to the caller **in the same call**.
- That pay-on-call model is only sound because ripcord's swap is atomic.

Hyperliquid is not atomic from a contract.
- A CoreWriter order is queued, executes seconds later, and may fill, partially fill, not cross, or be rejected.
- The EVM transaction succeeds regardless. The simulation tests show all of these cases.
- A ripcord-style keeper on Hyperliquid would be paid for orders that filled nothing.

**Klear's invariant** has two parts.

*The repair reward is paid once, if and only if all of the following hold:*

1. an attested snapshot of KeelLeg shows `lastNonce` equal to the nonce after the job's last signed order;
2. that snapshot was read at least `D_max` HyperCore blocks after that order was queued, so every signed order has executed or died;
3. the spot leg in a fresh attested Base balance equals the job's attested baseline, byte for byte;
4. the perp position moved only in the signed order's direction, by at most its size, and (for short increases) at an average fill no worse than its limit;
5. `|spot + perp| ≤ τ`.

*Authority:*
- No agent chooses any order parameter.
- The judge computes side, size and limit from attested state:
  - size is capped by the per-order cap and the job's remaining worst-case loss budget;
  - the limit sits half a band from the **mark** price (the tradable price);
  - at execution, KeelLeg re-checks the band against the live mark, and refuses to trade at all while mark and oracle disagree by more than a basis cap.
- The signer is a NEAR Chain Signatures key. No operator key exists.

**The workflow:**
1. Any agent proves the hedge is broken: a Read MPC-attested KeelLeg `Snapshot` on HyperEVM and a `Balance` log on Base.
2. The judge on NEAR opens a job and asks the MPC to sign one bounded IOC order.
3. Anyone relays it to KeelLeg.
4. After the delay, anyone proves the final state.
5. The judge pays, signs the next attempt, voids the job, or freezes the strategy.

**Flattening is a separate job kind.**
- **Trigger:** the owner's instruction, or repair exhausted after `max_failed_attempts` *executed* failures. An unrelayed order never counts, so a griefer cannot force a flatten.
- **Success:** both legs at dust.
- A repair can never succeed by closing both legs: in repair mode the judge never signs a spot action, and a changed spot leg voids the job.

### Against the alternatives

| | Third-party repair without exiting | Paid only on verified final state | Works on an asynchronous venue | Operator key that can de-hedge |
|---|---|---|---|---|
| **DLTX V1** (repo source) | No: `order` is execution-key only. The fallback is exit: owner, or anyone after 7 days via `beginExitStopped`. | No rewards | Yes (HyperCore) | Yes: their docs admit a compromised operator can zero the short |
| **Lambda** | No | No: fills unproven, no reconciliation, Hyperliquid leg not live on testnet | Claimed, not shown | n/a |
| **Index Coop ripcord** | Yes, bounded | No: pays on call | No: atomic only | Manager sets parameters |
| **Klear** | Yes, bounded, and repair cannot become flatten | Yes: attested post-delay snapshot, once | Yes: nonce + `D_max` settlement rule | None: MPC key under the judge's rules |

**Why NEAR, honestly:**
- If both legs lived on Hyperliquid, a HyperEVM-only contract could do all of this with precompile reads, and NEAR would add nothing.
- NEAR earns its place only for a **cross-chain hedge**: spot on Base, perp on Hyperliquid, judged by one neutral contract through Read MPC, and controlled by a key that belongs to no one.
- Klear-0's real gate tests the hard half, the Hyperliquid leg. The Base probe is gate G5.

**Defensibility:** this is a precise, testable design claim, not a moat. DLTX has the primitives (bounded orders, precompile reads) and could add permissionless repair in weeks.

## DLTX V1: deployed or not?

The discrepancy is unresolved, and that is what blocks a final verdict on DLTX.
- **The repo:** README (export commit `dd0f96651`, pushed 2026-10-31) says V1 is not deployed.
- **The docs:** you report that they say V1 is deployed. `docs.dltx.org` is unreachable from this machine and from the server-side fetcher, so I could not read them.

The check: take the addresses on `docs.dltx.org/contract-addresses`, then compare `eth_getCode` on each stated chain against a build of the repo at `dd0f96651` (ignoring metadata and immutables).
- **Code matches:** the README is stale, and the comparison above holds.
- **Code differs:** a newer, unpublished version is live. If it adds third-party repair, Klear's distinction is gone and Klear should be rejected.

## Confidential Klear (B) vs Standard Klear (A): choose A

What leaks, from the code that exists here:

| Secret B would hide | Where it becomes public |
|---|---|
| Band `b` | `KeelLeg.order` calldata and CoreWriter `RawAction` carry `limitPx = mark × (1 − b/2)`. One order plus that block's mark gives `b`. |
| Size cap / loss budget | `sz` in the same calldata. Any capped order reveals the cap. |
| Tolerance `τ` | Agents must know when the hedge is broken in order to act. Either `τ` is public, or they query whoever holds it, and repeated queries bisect it. |
| Target ratio | The post-repair Hyperliquid position (public via API and precompile) and the Base balance |
| Flatten trigger | A commit-reveal or TEE trigger means only the key holder can start a flatten, so it stops being permissionless |
| Positions, fills | Always public on Hyperliquid and Base. NEAR Confidential Intents cannot change that. |

Judgement on B:
- **Repair parameters can't stay private.** OutLayer could hold the policy, but its output (the order) reveals the policy. Its "is it broken?" interface is an oracle that leaks the policy anyway.
- **It adds trust.** In Encore, an on-chain OutLayer result trusted `worker.outlayer.testnet`'s full-access keys unless the TDX quote was verified on-chain. That contradicts "verified by anyone".
- **The one real privacy property is narrow.** Funding through Confidential Intents can unlink the *owner's* NEAR identity from the strategy. It cannot unlink the two legs from each other, because the judge's config names both.
- **That property is a deployment choice**, already offered by NEAR's confidential perps. It is not a Klear capability, and Klear should not market it as one.

## What was built (all local, all simulation unless marked live)

| Piece | What | Status |
|---|---|---|
| `contracts/evm/src/KeelLeg.sol` | HyperCore account controlled only by EIP-712 signatures from the controller. Actions: IOC orders (size cap, lot, tick and 5-significant-figure checks, a band around the mark price at execution, refused when mark and oracle diverge past a basis cap), spot→perp margin, sweep to a fixed payout. `Snapshot` log with oracle, mark, `lastNonce`, `lastQueuedL1`. | 24 Foundry tests |
| `contracts/evm/test/sim/` | **SIMULATION** of HyperCore behind the real system addresses: delayed queue, IOC against limited depth, partial fills, no-cross, reduce-only, margin rejection, exchange-side position changes | |
| `crates/keel-core` | The judge: strict ABI decoding of both logs, order planning, settlement (repair/flatten/void/exhaust/freeze), rewards, replay and race rules, the EIP-712 digest, and the Read MPC payload hash | 27 Rust tests; payload encoder matches near/mpc's upstream snapshot vector `2ab97999…` and the live MPC network |
| `contracts/evm/test/e2e/` | Foundry logs → Rust judge via `ffi`, full loops. The judge's digest equals `KeelLeg.orderDigest` (fuzzed). The MPC signature shape is accepted by KeelLeg. | 8 tests |
| `scripts/live/read.py` | **LIVE, read-only**: KeelLeg's own read path runs inside an `eth_call` on HyperEVM testnet against the real precompiles | 6/6 accounts' `szi` match the Hyperliquid API; the oracle matches (`docs/results/`) |
| NEAR views | **LIVE, read-only** checks on `v1.signer-prod.testnet` 3.18.0: see the list below | |
| `fixtures/readmpc/` | **LIVE data, not submitted**: the exact `verify_foreign_transaction` arguments and expected payload hash for a real finalized HyperEVM log | |
| `scripts/testnet/keel0.sh`, `scripts/testnet/relayer.py` | The real experiment: `status`, `deploy`, `snapshot`, `attest`, `order`, `sweep`; relayer funding on HyperCore | **Run on testnet: G1–G3 pass** (below) |
| `contracts/near-keel` | The judge on NEAR: `attest` (Read MPC, bound by `expected_payload_hash`), `open_repair`/`settle`/`open_flatten` running keel-core, MPC `sign` for the derived controller, payout transfer | 4 unit tests; **run on testnet: G4 pass** |
| `scripts/testnet/g4.sh` | Accounts, HyperEVM deployments, judge deployment, evidence, attest, open, relay, settle | Run on testnet |

Live checks on `v1.signer-prod.testnet` 3.18.0:
- ForeignTx domains are 3 and 7; secp256k1 Sign domains are 0 and 4.
- `HyperEvm` and `Base` are both available chains.
- The request needs a 1 yoctoNEAR deposit and at least 15 Tgas.
- `derived_public_key` → EVM address (`0x773d…c5f4` for the placeholder predecessor `keel-demo.testnet`), confirmed with an independent base58 + keccak derivation.

Run everything local with `make test`; the testnet steps are in [testnet-runbook.md](testnet-runbook.md).

Facts established along the way:
- Read MPC returns only `payload_hash` and a signature. The NEAR contract must state the full expected log (`EvmLog`, with `data` as the provider's hex string) and bind it with `expected_payload_hash`.
- Precompile `entryNtl` is USD × 1e6, and the ETH oracle is raw × 10^-(6−4).
- On HyperEVM testnet, `finalized` trailed `latest` by one block.

## The real-network gate

| Gate | Must prove | Kills Klear if |
|---|---|---|
| G1 attest | `verify_foreign_transaction` (domain 3, HyperEvm, Finalized) resolves for a KeelLeg `Snapshot` log with **our** `expected_payload_hash`, and the decoded `szi` equals the API at that block | nodes never sign our hash (format mismatch), or finality or timeouts make attestation unusable |
| G2 authority | An MPC signature from `sign` (path `keel/<id>/hyperevm`, domain 0) over the judge's digest is accepted by the deployed KeelLeg, relayed by an unrelated EOA paying gas | KeelLeg cannot be controlled by a derived key |
| G3 execution | HyperCore executes KeelLeg's CoreWriter IOC. The precompile and the API show the change. We measure the delay in L1 blocks to set `D_max`. A non-crossing IOC leaves a successful EVM transaction and an unchanged position. | contract-originated orders don't execute, or the delay is unbounded |
| G4 judge + reward | A NEAR contract wrapping keel-core opens a job from attested state, settles on attested state, and pays once; a second claim is refused on-chain | the contract cannot verify evidence, sign, or pay exactly once on-chain (it can: see G4 below) |
| G5 cross-chain | A Base Sepolia `BalanceProbe` log is attested via Read MPC `Base` | |

## Real-network results (2026-11-12)

Hyperliquid testnet (HyperEVM chain 998, HyperCore) and NEAR testnet (`v1.signer-prod.testnet` 3.18.0). Accounts:
- NEAR `keel-8f2f34.testnet`, created by `make keys` via the faucet;
- relayer `0x1d9D…615c`, funded with 100 mock USDC sent by the user;
- KeelLeg controller `0x4911…8154`: the MPC key for `keel/1/hyperevm`, which holds nothing.

| Gate | Result | Evidence |
|---|---|---|
| **G1 attest** | **Pass**, twice | A KeelLeg `Snapshot` log (HyperEVM tx `0x18609f1b…`) attested by Read MPC (NEAR tx `76YXE3Xb…`, domain 3, `Finalized`), with `payload_hash` `d91d0cc8…` equal to our precomputed hash. The signature independently recovers to the domain-3 key's address `0xfb2e…dc28`. The post-trade snapshot (`0x4a33039b…`) was attested too (NEAR tx `FsqNkCkF…`, `8f162dbb…`). |
| **G2 authority** | **Pass** | `sign` from `keel-8f2f34.testnet` (NEAR txs `FAZGkFZ6…`, `584LEQnk…`, `8nVPpb6R…`) produced signatures that KeelLeg accepted on-chain, relayed by an address that is not the controller. KeelLeg verifies the signer, so a wrong signature reverts. |
| **G4 judge + reward** | **Pass** | Judge contract `judge.keel-8f2f34.testnet` (code sha256 `70e78bea…`, equal to a local build; deploy `6ZHN4et6…`). The agent `agent.keel-8f2f34.testnet` ran the loop. It got the broken hedge's evidence attested *by the judge* through Read MPC (`GWpEqD1k…`, `C9DEZeeW…`) and opened job 1 (`7nsJYg9o…`). The judge planned **sell 0.006 ETH, limit 1976.0** and had the MPC sign it (`signed 1:0`). A relayer submitted it to judge-controlled KeelLeg v3 (`0xEB0e…12A5`, relay `0x8a514c65…`), and it filled 49 blocks later. Settling on a snapshot 255 blocks after the order was **refused on-chain** (`snapshot-not-settled`, `BwwddBdX…`). Settling on one 1,107 blocks after **paid the agent 0.5 NEAR** (`CVZfJs7N…`; agent balance 0.4928 → 0.9896). Three later claims were refused on-chain: settle again `no-open-job` (`fg3GtGYG…`), reuse the evidence `evidence-reused` (`A1PBVBKu…`), and a fresh healthy-hedge job `hedge-within-tolerance` (`3cY9FbgC…`). In this run the spot leg was a testnet-only token on HyperEVM (`TestWETH`), read by `BalanceProbe`. |
| **G5 Base** | **Pass for attestation** | A real finalized Base Sepolia log (WETH9, block 57,752,585) was attested through `judge.attest("base", …)` and stored (`8dgBMpvg…`). Not yet done: the spot leg on Base inside the paid loop, which needs Base Sepolia ETH for `BalanceProbe` and the token. |
| **Fill delay** | 8 samples | 78, 34, 70, 51, 54, 54, 40, 62 HyperCore blocks from queueing to the fill being visible (median 54, max 78; about 3–6 s). Each is an upper bound. The judge's settlement window is set at 300 blocks. |
| **G3 execution** | **Pass** | v2 KeelLeg's IOC (relay `0x9082ef84…`) filled on HyperCore: **sell 0.006 ETH @ 1972.9, "Open Short"**. The order carried the signed client order id `0x…2b631ef4` and filled better than its limit of 1963.5. The precompile saw it **78 HyperCore blocks after queueing** (≈5–6 s; one sample, an upper bound). The attested post-trade snapshot shows `szi = −0.006 ETH` and `entryNtl` 11.8374 USD (= 0.006 × 1972.9). |

Submission without execution, observed on the real venue (EVM transaction succeeds every time):
- **Unfunded account:** the CoreWriter order was dropped. No order exists on HyperCore (`unknownOid`).
- **IOC that doesn't cross** (relay `0xcc2b05f7…`): HyperCore recorded it as `iocCancelRejected`, and the position was unchanged.
- **Signed order that went stale before relay:** KeelLeg reverted with `OutsideBand`, so nothing reached HyperCore.

Design changes the network forced (all now in code and tests):
1. **The band is anchored to the mark price, plus a basis cap.**
   - Testnet ETH's book trades about 3.9% under its oracle; mainnet diverges during exactly the stress Klear exists for.
   - With an oracle-anchored band, no sell could ever cross.
   - v1 (`0x336c…f2f1`, oracle-anchored) is superseded by v2 (`0xf447…88a5`), with a mark band and a 5% basis cap. The cap is a testnet setting; mainnet would use about 1–2%.
   - The judge refuses to plan while the observed basis exceeds the policy cap, and voids, rather than freezes, a job caught by it. It charges the observed basis to the loss budget.
2. **Limits are planned at half the band.** A limit planned exactly at the band edge was voided by about 0.004% of price drift during the roughly 15 s MPC signing.

Funding facts:
- **Account activation:** a new HyperCore account (the relayer, each KeelLeg) costs a one-time 1 USDC, taken from the first transfer to it.
- **Deploy gas:** KeelLeg's deployment used about 1.69M gas, under the 3M block limit; no big blocks are needed.
- **Testnet funds:** reaching mock USDC required one small real deposit by the user (8 USDC, Arbitrum → Hyperliquid mainnet), which unlocked the faucet.

## Known limits (not hidden)

- **No rate limit.** KeelLeg caps each order but not the number of orders. A compromised judge or MPC can lose `b + fee` per trade, repeatedly. A per-window notional cap is not built.
- **Reduce-only buy prices** are not verified ex post; they rely on HyperCore enforcing the IOC limit. Short increases are checked via `entryNtl`.
- **The Base half of a flatten** is an instruction (`spot_sell`, with `minOut`). Klear-0 does not sign Base transactions.
- **The judge account is not locked yet.** It still has a full-access key (in `.secrets/`), so "no human key can make KeelLeg trade" holds only until that key is deleted. Deleting it is irreversible and is the owner's call.
- **The paid run's spot leg was a HyperEVM test token**, not Base. Base attestation itself works (G5), but the Base leg inside the paid loop is not done.
- **`D_max` rests on 8 samples** (max 78 blocks) on a quiet testnet. Mainnet values need a distribution under load.
- **The judge stores strategy state as JSON** and re-parses it on each call. That's fine for one strategy; a multi-strategy version should use typed storage.
- **v1 KeelLeg was swept** with a controller-signed sweep (`0x3f32ca3b…`, 48 USDC to the fixed payout). This confirmed the CoreWriter units: transfer notional is USD×1e6, spot USDC wei is 1e8.
- **The end-to-end tests run single-threaded:** parallel `ffi` launches of a just-rebuilt judge binary intermittently exit 69 on macOS.
- **Donation griefing.** Sending WETH to the spot account creates a repair job. It is unprofitable only while `repair_reward < τ × price`, so that constraint must be enforced at strategy creation.
