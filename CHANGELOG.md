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
- **Live**: six rescues on testnet (an AI manager's outage with an AI guardian; the investor's own exit with a
  human guardian; the practice strategy, by its drill and by a stranger; the deleverage strategy's two exits, with a
  stranger's tools), 20 bypass attempts refused, and a confidential payout path on mainnet.
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
- **A sealed strategy** (`agents/manager.py --sealed`, `agents/keel_agents/sealed.py`, `docs/results/sealed`): the
  manager decides in a TEE on NEAR AI Cloud, end-to-end encrypted and verified against TDX and GPU attestation; every
  decision's receipt goes on chain (in `propose_order` for a trade, in `heartbeat` for a hold), which the locked judge
  ignores, and `agents/verify_sealed.py` checks it from the chain alone.
- The scripts' curl retries can no longer glue a rate-limited reply to the next one (`--fail`, a temp file per call).
- **A confidential mandate on mainnet** (`scripts/mainnet/mandate.py`, `docs/results/mandate`): an Agent API account
  with the mandate as its confidential policy, owned by an MPC-derived key; every owner action signed by NEAR's MPC.
  Funded by the user: a sealed AI swapped inside the confidential balance, a withdrawal to a stranger was refused,
  and the exit (grant revoked, exit granted) sent everything to the user's own addresses.
- Agents fall back to DNS over HTTPS when the local resolver drops a name, and every TLS client in the process uses
  certifi's bundle.
- **A hosted MCP server** (`/api/mcp` on the site; `AGENTS.md`): read-only tools any agent reaches by URL
  (`list_strategies`, `inspect_strategy`, `rescue_status`, `how_to_rescue`, `verify_sealed_receipt`), checked with the
  official MCP client against live chain data; rescues still sign locally.
- **The site shows the private parts**: `/proof/sealed` and `/proof/mandate`, a privacy section on the home page,
  and the investor's private options on `/investor` and in the creation wizard.
- **Sealed decisions verified on NEAR** (`contracts/klear-tee`, `klear-tee-4746e3.testnet`, locked): NEAR's DCAP
  verifier checks the model's Intel TDX quote bound to its signing key and a fresh nonce, and the receipt's signature
  is checked with NEAR's ed25519; an altered receipt is refused on chain.
- **A locked owner for the confidential mandate** (`contracts/klear-owner`, `klear-owner-d48b38.testnet`): set up once
  and sealed, then signs only readable grant changes on a trigger; a stranger cut the AI off on the investor's exit.
- **Recorded runs of an off-the-shelf agent** (`agents/agent_run.py`, `docs/results/agent-runs`): Claude Code, with only
  Klear's MCP servers and its own NEAR account, finds the strategy that needs a rescue, checks it, rescues it and is
  paid. `wait_for_rescue` added to the local MCP server. Three runs: two paid 0.15 NEAR each (practice; deleverage,
  right after a sealed trade, where the agent recovered from a refused open on its own), one failed on our RPC query.
- The manager relays an approved order as soon as the MPC signature reaches the judge (it retries for up to 40 s
  instead of trying once after 4 s), and `relay_order` fails with the script's output when nothing was relayed.
- The drill's compact table on `/practice` no longer overflows a 360 px phone.
- **Renamed from Keel to Klear.** Everything deployed before the rename keeps its name (`keel-*` accounts,
  `KeelLeg`, `KeelVault`, `KeelDeployer`): those contracts are locked, and their source stays byte-for-byte so the
  published hashes still match.
- A guardian whose process stops mid-rescue resumes its own open job (`agents/guardian.py`), and HyperEVM reads
  retry a node that has not yet seen a block another node named.
