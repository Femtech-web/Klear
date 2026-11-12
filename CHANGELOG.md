# Changelog

## v0.1.0

The first release: the judge, the two strategy accounts, the agents, the replay and the site, as run live on
testnet and once on mainnet (see `docs/results/`).

- **Judge v3** (`contracts/near-keel`, wasm sha256 `be140d65…` for the deployed judges): the investor's mandate
  for a manager (size, band, leverage on a conservative cross-chain liquidation value, floor, heartbeat with an
  investor-chosen silence response), the investor's own exit, and a two-leg rescue anyone can run, paid per leg
  only on attested delivery. Evidence only through NEAR's Read MPC; actions only as Chain Signatures.
- **KeelLeg v6** (HyperEVM): bounded IOC orders and sweeps to an immutable payout; snapshots carry the payout's
  USDC so a verifier can see a sweep arrive. **KeelVault** (Base): one atomic exit of a whole token balance to an
  immutable payout, with an `Exited` receipt.
- **Agents**: an AI manager (Claude, a NEAR key limited to `propose_order` and `heartbeat`) and a guardian (AI or
  deterministic), every autonomous decision logged with its prompt.
- **Alpha Arena replay**: 32 AI agents' real Hyperliquid history through `keel_core::rules`.
- **Site** (`web/`): Next.js, Tailwind, TypeScript; every chain read server-side; WCAG 2.2 AA in light, dark and
  mobile.
- **Live**: two rescues on testnet (an AI manager's outage with an AI guardian; the investor's own exit with a
  human guardian), 20 bypass attempts refused, and a confidential payout path on mainnet.
