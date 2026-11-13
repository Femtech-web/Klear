# Internal security review

**This is not an audit.** It is the review we ran on our own code before asking anyone to trust it, written
down so a reader can see what was checked, what was found, and what is still open. Nobody independent has
reviewed Klear. Everything runs on testnets.

Date: 2026-11-12. Scope: the judge (`contracts/near-keel`, `crates/keel-core`), the factory
(`contracts/near-keel-factory`), the EVM contracts (`contracts/evm/src`), the agents and scripts that sign
transactions (`agents/`, `scripts/testnet/`), and the site (`web/`).

## Method

| Check | Tool | Result |
|---|---|---|
| Static analysis of the EVM contracts | Slither (80 detectors) | 9 results, none exploitable; each below |
| Rust lints | `cargo clippy --all-targets` on the workspace and both contracts | style only (6), no correctness lints |
| Known-vulnerable Rust crates | `cargo audit` (RustSec) | none in any deployed wasm; details below |
| Known-vulnerable npm packages | `npm audit` | the site's runtime: 0; dev tooling: below |
| Secrets in the repository | gitleaks (pre-commit and CI), never-public paths check | 0 findings in the 136 files of the latest change |
| The rules, adversarially | 41 engine tests, 13 judge tests, 5 factory tests, 43 Foundry tests, 9 end to end | all pass |
| The rules, live | 20 bypass attempts against the locked judges ([try-to-break-it.md](try-to-break-it.md)) | all refused on chain |
| Manual review | the invariants below, line by line | 1 bug fixed, 3 residual risks |

## The invariants, and where each is enforced

| Invariant | Enforced by | Checked |
|---|---|---|
| Only the judge can sign for the strategy's accounts | `KeelLeg`/`KeelVault` accept only the immutable `controller`; the controller is the MPC key derived for the judge's account | live inspection (`/strategies/<judge>`, `inspect_strategy`), Foundry tests |
| Funds can only go to the investor | `payout` is immutable in both contracts; `KeelLeg` sends only to it, `KeelVault.exit` only to it | Foundry tests; live payout reads |
| Signatures cannot be replayed or reused elsewhere | EIP-712 domain with `block.chainid` and the contract's address; a strictly increasing nonce consumed before any external call; low-s only | Foundry tests; Slither |
| The judge acts only on verified evidence | Read MPC attests each log; the judge checks the emitter (its own KeelLeg and vault), the account, the perp and the spot token, freshness, and that evidence is not reused | engine tests; live: a forged $1M snapshot was never attested |
| A rescue opens only on the judge's own trigger | `open_flatten` recomputes the trigger (floor on attested value, investor request, silence on its own clock) | engine tests; live refusal `flatten-not-triggered` |
| The opener cannot front-run another's evidence | a job opens only on perp evidence the caller attested | judge tests; live refusals |
| The manager cannot guard itself | the manager account is refused as a guardian | engine tests; live `mandate:manager-cannot-guard` |
| Rewards only on delivery | the perp reward requires the investor's HyperCore balance to have grown by what was owed; the spot reward requires the vault's `Exited` receipt to the investor | engine tests; both live runs |
| Nobody can change a judge | no access keys, no upgrade method; the factory never adds a key | live key counts; code hash against the source build |

## Findings

### Fixed: path traversal in the MCP server and `rescue.py` (low)

`start_rescue`, `rescue_log` and `rescue.py` built file paths from the `judge` and `account` arguments, so a
crafted name like `../../x` could write a log or a symlink outside `.keel-visitor/`. Both now accept only NEAR
account ids (`keel_agents.registry.account`). Local-only: the MCP server speaks over stdio to the user's own
client.

### Slither results (none exploitable)

- **`reentrancy-balance` in `KeelVault.exit`.** The balance is read before the token call. The nonce advances
  before the call (checks-effects-interactions), so re-entering `exit` needs a fresh judge signature, and the
  judge signs only for the configured spot token. `Exited` records the amount *sent*: a fee-on-transfer token
  would deliver less than it says. Klear's spot leg is WETH; such tokens are out of scope.
- **`incorrect-equality` (`amount == 0`)**: intended, an empty vault has nothing to exit.
- **`missing-zero-check` on `token`**: the token is bound by the judge's signature, and a call to an address
  without code reverts at `balanceOf`.
- **`reentrancy-events`** (events after `CoreWriter` calls): `CoreWriter` is HyperEVM's system contract; it
  queues actions for HyperCore and does not call back.
- **`timestamp`** (deadline checks): deadlines are minutes; validators' small timestamp leeway does not matter.

### Residual: a failed factory creation's refund (low)

If a creation batch fails, `on_created` refunds the creator from the factory's own balance, relying on the
failed batch's deposit having been returned to the factory first. NEAR processes that refund in the next block
alongside the callback, without a documented order. A creation reaching the callback with the refund still in
flight would fail its transfer, leaving the deposit in the factory. The factory is locked, so the code stays;
the mitigation is operational: keep the factory's free balance above a creation's deposit (anyone may send it
NEAR), and the wizard predicts and checks everything before signing, so creations should not fail.

### Residual: the factory does not vouch for strategies (by design)

Anyone can create a strategy with any config, including EVM accounts that its judge does not control. Such a
strategy is useless rather than dangerous to anyone who checks, which is why the site, the MCP server and
`factory.sh verify` all run the same six checks, and why the registry is a list, not an endorsement.

### Residual: wallet pages load wallet code (by design)

On `/practice`, `/create` and `/strategies/<judge>`, NEAR Connect fetches the chosen wallet's code from its
publisher and runs it in a sandboxed iframe (scripts only, no same-origin access). The Content-Security-Policy
on those pages allows exactly the wallets' hosts and NEAR's RPC; every other page allows the site alone. The
wallet code is the wallet's, as on any NEAR app; Klear pins which wallets are offered, not their code.

### Dependencies

- **The site's runtime**: 0 known vulnerabilities (`npm audit --omit=dev`).
- **The site's lint tooling**: 8 moderate, all `minimatch` through `eslint-config-next`; dev-only, never shipped.
- **The repository's tooling** (`near-cli-rs` and `cargo-near` npm installers): 4 high and 3 moderate in their
  nested `axios`, `form-data`, `minimatch` and `glob`. They run only at install time, to download those tools'
  release binaries; `npm audit fix` cannot reach them (the packages pin their own). Accepted until upstream
  updates.

### Rust

- **`cargo audit`** (RustSec, cargo-audit 0.23.0): the workspace is clean. Both NEAR contracts' lockfiles carry
  `crypto-bigint` 0.5.5 (RUSTSEC-2026-0387, timing variability) and `unsafe-libyaml` (unmaintained), but
  neither is in the contract's wasm (`cargo tree --target wasm32-unknown-unknown -e normal` does not reach
  them): they come with near-sdk's unit-testing harness. `wee_alloc` 0.4.5 *is* in the wasm, as near-sdk
  5.30.1's default allocator; it is flagged unmaintained (RUSTSEC-2022-0054), not vulnerable. A future judge
  build can drop it by disabling near-sdk's `wee_alloc` feature; the deployed judges are locked as built.
- **`cargo clippy --all-targets`** (clippy 0.1.95): no correctness or suspicious lints. Style only: four "use
  `.is_multiple_of()`" in `keel-core` and two "too many arguments". Left as they are on purpose: changing
  `keel-core` changes the judge's code hash, and the archived sources must keep rebuilding to the locked
  judges' and the factory's deployed hashes.

## What a real audit should look at first

1. The engine's valuation under extreme prices and HyperCore's precompile edge cases (rounding in
   `oracle_1e8`, `spot_1e8`, dust thresholds).
2. The settle state machine across partial fills, ADL and liquidation between snapshots.
3. The judge's Read MPC request encoding against the MPC contract's own (`expected_payload_hash`).
4. `KeelLeg`'s CoreWriter action encoding against HyperCore's current action formats.
5. The factory's refund path (above) on a deliberately failing creation.

## Addendum, 2026-11-13: the private parts and the hosted MCP

New code since the review, checked the same way (by hand, against what each piece may touch):

- **Hosted MCP** (`web/lib/mcp/server.ts`, `web/app/api/mcp/route.ts`): read-only by construction; no tool signs,
  and none takes a key. Every argument is validated before any chain read (NEAR account ids against the account
  grammar, transaction hashes as base58), with unit tests for the refusals. A tool's failure returns `isError`, not a
  stack. Rescues stay in the local server, which signs only with the key its user names.
- **The mandate script** (`scripts/mainnet/mandate.py`): every owner signature is recovered locally and must equal
  the owner before it is submitted; the API key is read from `.env` and never printed; grant tokens are written to
  `.secrets/mandate/` with mode 600, and only their sha256 leaves the machine. Its records were scanned with
  gitleaks; one false positive (a grant's commitment) was redacted in the record, and the script now stores only
  status fields.
- **The sealed path** (`agents/keel_agents/sealed.py`): an answer is used only after `verify_response` checks its
  signature against the attested model key, and only `provider_tee` signatures count. The strategy and the AI's
  reasoning go only to the git-ignored private record; the console prints "(reasoning sealed)". The receipt's
  public key tripped gitleaks' generic rule; that exact key is allowlisted with its reason.
- **DNS fallback** (`agents/keel_agents/net.py`): used only when the system resolver fails; it changes the address,
  never the TLS check, which still verifies the certificate against the original host name.
- **Shell retries** (`scripts/testnet/*.sh`): `curl --retry` wrote a rate-limited reply and the retried one into
  the same output; `fetch()` now uses `--fail` and a temp file per call.

Still open, as before: none of this is audited, and the confidential mandate's policy is enforced by the
provider's backend, not by a Klear contract.

### The two new contracts (2026-11-13)

- **`contracts/klear-tee`**: anyone may call it, and nothing it records can be forged past NEAR's own checks: a signer
  is recorded only from the DCAP verifier's callback, with report_data equal to exactly the key and the nonce, TCB
  `UpToDate` and debug off; a receipt only if `ed25519_verify` passes against a recorded key for the same model.
  Tests include the live receipt as a vector and an altered one. Locked after deploy.
- **`contracts/klear-owner`**: before `seal`, only the investor can have anything signed (the trust step, stated in
  the docs); after it, `sign_setup` is closed and `sign_grant` requires a trigger and a payload naming this agent,
  mainnet and this owner, with only the two plaintext grant actions accepted. Its EIP-712 digests are tested against
  a reference implementation on real API payloads. Locked after deploy. Open: a grant issued after a trigger can also
  swap within the policy's budget; withdrawals still reach only the investor.
