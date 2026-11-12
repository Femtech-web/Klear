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
- **Live**: four rescues on testnet (an AI manager's outage with an AI guardian; the investor's own exit with a
  human guardian; the practice strategy, by its drill and by a stranger), 20 bypass attempts refused, and a
  confidential payout path on mainnet.
- **Judge v3.1** (wasm sha256 `2aeaaf8b…`): a deleverage job (an early cut back to the investor's target leverage,
  before the floor), the investor's `rearm` after a rescue, `fund_pool`, a one-call `status` view, and delivery
  timestamps per cycle. The two v3 judges of the live run stay as they are: they are locked.
- **Factory** (`contracts/near-keel-factory`, `2bd8332e…`), deployed and locked at `keel-factory-bcf915.testnet`:
  anyone creates a strategy's judge in one transaction, locked from birth, and the public registry lists it.
  **KeelDeployer** puts a strategy's KeelLeg and KeelVault at CREATE2 addresses that commit to their controller,
  payout and limits.
- **The practice strategy and the daily drill**: a real strategy created through the factory fails on purpose
  every day (`agents/drill.py`, `scripts/drill/launchd.sh`); anyone can rescue it with only a NEAR account
  (`agents/rescue.py`, `make rescue`), while the courier pays the EVM gas (`agents/courier.py`).
- **Site**: the product (strategies, a live inspection of any strategy, the practice rescue) and the proof
  (`/proof/*`) as separate sections; a judges' guide with live checks (`/judges`, `JUDGES.md`); every chain read
  uncached, deduplicated per request and retried on rate limits.
- NEAR reads moved to FastNEAR: `rpc.testnet.near.org` is deprecated and answers 429.
- **A stranger's rescue**: a faucet account with no EVM gas and no role rescued the practice strategy with
  `make rescue` and was paid 0.15 NEAR, both legs delivered first (`docs/results/visitor`).
- **Wallets and creation on the site**: NEAR Connect for the browser rescue, the investor's exit and rearm, and the
  reward pool; `/create`, a five-step wizard that predicts every address before anything is signed.
- **For AI agents**: an MCP server (`agents/mcp_server.py`) to list strategies, inspect one and run its rescue.
- **The daily drill on GitHub Actions** (`.github/workflows/drill.yml`), recording every cycle.
- **A live deleverage** (`docs/results/delever`, `agents/delever_demo.py`): on a factory-made strategy under its
  warning level, a guardian cut 0.01 ETH to the 0.2x target with the order the judge planned, and was paid 0.1
  NEAR only on a settled snapshot showing it. The site's `/proof/deleverage`.
- **An internal security review** (`docs/security-review.md`; not an audit).
- **The site**: product and proof as separate sections, a judges' guide with live checks, Instrument Sans and Geist,
  a neutral palette that passes WCAG 2.2 AA in light and dark, and layouts checked at 360 px.
