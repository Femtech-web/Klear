# Keel

**Keel lets investors give AI agents authority to manage their money without giving them unrestricted
control. Every trade must obey the investor's rules, and independent guardians can protect the remaining
funds when the manager fails.**

The investor sets the rules once: order size, price band, maximum leverage, a loss floor, whether a silent
manager should trigger an exit, and the investor's own payout addresses. They live in a NEAR contract with
no keys, which is the only thing that can make NEAR's MPC network sign for the strategy's accounts on
Hyperliquid (`KeelLeg`) and Base (`KeelVault`). Both accounts can only ever pay out to the investor.

- **The manager** (an AI agent or a person) can only propose orders. The judge signs those that fit the
  mandate on cross-chain state attested by NEAR's Read MPC.
- **Any guardian** (a person or an AI) can run the rescue once the judge sees a trigger: the floor, the
  investor's own request, or a silent manager if the investor chose that. The rescue closes the perp, sweeps
  the USDC and moves the Base asset, and **pays each leg's reward only when the investor's address shows
  the money arrived**.
- **The investor** can trigger the exit at any time, and can never be locked out of it.

| Read | For |
|---|---|
| [docs/architecture.md](docs/architecture.md) | the pieces, the module map, and why everything waits for evidence |
| [docs/rescue.md](docs/rescue.md) | triggers, both legs, every failure case, and the exact liquidation value |
| [docs/trust-model.md](docs/trust-model.md) | what "no keys" does and does not mean, and how to check each claim |
| [docs/privacy.md](docs/privacy.md) | what is public, what could be private, and the trade-off Keel cannot escape |
| [docs/landscape.md](docs/landscape.md) | who already does what, and where Keel is and is not different |
| [docs/human-guardian.md](docs/human-guardian.md) | running a rescue by hand |
| [docs/try-to-break-it.md](docs/try-to-break-it.md) | 16 attacks on the live, locked judges: how to try each, and what happened when we did |
| [docs/results/g7/README.md](docs/results/g7/README.md) | the live run: an AI manager, an outage, an AI guardian's rescue, and the investor's own exit |
| [agents/README.md](agents/README.md) | the AI manager and guardian, and how their decisions are logged |
| [docs/keel0.md](docs/keel0.md) | the feasibility decision and every live result so far |

```
make test        # all local tests: Rust rules, Foundry (SIMULATION of HyperCore), end-to-end through the judge, NEAR contract
make judge       # build the NEAR judge (cargo-near) and print its sha256
make live-read   # read-only checks against live HyperEVM testnet
make keys        # testnet NEAR account + relayer key into .secrets/ (prints addresses only)
make status      # what is funded and deployed
```

| Path | What |
|---|---|
| `contracts/evm/` | `KeelLeg` (Hyperliquid account: signed IOC orders in a band, sweeps, `Snapshot` evidence), `KeelVault` (Base account: one exit to a fixed payout, `Exited` receipts), `BalanceProbe`, `HyperCore` bindings; `test/sim/` is a **SIMULATION** of HyperCore |
| `crates/keel-core/` | The rules, pure Rust: `evidence`, `eip712`, `readmpc`, `mpc`, and `engine/{orders,valuation,mandate,repair,rescue}`; the `keel-judge` CLI |
| `contracts/near-keel/` | The judge on NEAR: Read MPC attestation in, MPC signatures and rewards out |
| `agents/` | The AI manager and the guardian (AI or deterministic) |
| `scripts/testnet/` | Live runbooks per gate (`g7.sh` is the current one), `relayer.py`, `watch.py` |
| `scripts/keys/`, `scripts/live/` | Key generation (testnet, and one authorized mainnet test account), read-only checks |
| `docs/results/` | Every live transaction, log and AI decision behind the docs |
| `fixtures/readmpc/` | A real HyperEVM log and its prepared Read MPC request |

Requires Rust, Foundry, Python 3 and Node.js. Keys and secrets never enter the repository (`.secrets/`,
`.env`, and a gitleaks pre-commit hook in `.githooks/`). Nothing here is audited; all live runs are on
testnets with test funds.
