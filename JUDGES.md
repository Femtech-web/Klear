# For judges

Keel lets investors give AI agents authority to manage their money, without giving them unrestricted control.
This is the order to check it in. Five minutes covers the essentials; forty-five if you rescue a strategy
yourself. The site's `/judges` page is the same guide, with each live check run as the page loads.

Everything below runs on testnets with test funds, except one authorized mainnet privacy test. Nothing here is
audited. Commands are view calls that need no account unless marked.

## In one minute

- **The problem.** Giving an AI agent money means giving it the keys. In Alpha Arena's Season 1.5, 30 of 32 AI
  models that traded $10,000 each on Hyperliquid ended with less.
- **What Keel does.** The investor's rules live in a NEAR contract with no keys (the judge), the only thing
  that can make NEAR's MPC network sign for the strategy's accounts on Hyperliquid and Base. The AI proposes;
  the judge signs only what fits. If the AI fails, anyone can bring the money home, and is paid only once the
  investor's address shows it arrived.
- **Why NEAR.** Chain Signatures let one locked contract control accounts on two other chains; Read MPC lets it
  verify what happened there before acting. No bridge, no oracle we run, no key anyone holds.

## The path

### 1. The problem, in real money (2 min)

[docs/results/replay](docs/results/replay/README.md): 32 Alpha Arena agents replayed fill by fill through Keel's
rules. With a 3x leverage cap and a floor 30% down, 23 would have been stopped and investors would have kept
**$56,772** more; it would have been worse for 3, which recovered later. The rebuild matches Hyperliquid's own
equity points within a median 1.3% of the stake. Rebuild it: `make replay && git diff --exit-code docs/results/replay`.

### 2. Nobody can change the rules (1 min)

Five contracts, each with no access keys and the code built from this repository:

| Contract | Account | Source build sha256 |
|---|---|---|
| Judge of the AI-manager run | `keel-ai-76e036.testnet` | `be140d65…` ([hashes](docs/results/g7/code-hashes.txt)) |
| Judge of the investor-exit run | `keel-human-c0caa7.testnet` | `be140d65…` |
| Factory | `keel-factory-bcf915.testnet` | `2bd8332e…` ([hashes](docs/results/factory/code-hashes.txt)) |
| Judge of the practice strategy | `practice.keel-factory-bcf915.testnet` | `2aeaaf8b…` |
| Judge of the deleverage run | `delever.keel-factory-bcf915.testnet` | `2aeaaf8b…` |

```bash
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"keel-ai-76e036.testnet"}}'
# "keys":[]  (repeat for each account; view_code's code_base64, sha256-hashed, gives the build's hash)
```

### 3. A rescue, end to end (3 min)

[docs/results/g7](docs/results/g7/README.md). An AI manager (Claude) trades under an investor's mandate; a trade
past its leverage limit is refused ([`F8beikMX…`](https://testnet.nearblocks.io/txns/F8beikMXotPVh9ConjZWvtJZ8fGNisr9kmryi8wnUwfK));
the manager goes silent; an AI guardian opens the rescue, and both legs move at once
([`5hHHC9Fz…`](https://testnet.nearblocks.io/txns/5hHHC9FzYFJNEW32j2A4nT6YEuZKky3Xt2mVThavXqKq)). 7.887 USDC reaches the
investor on HyperCore, and **only then** is the guardian paid 0.5 NEAR
([`7pYXKcXG…`](https://testnet.nearblocks.io/txns/7pYXKcXGGdxXjKjR4qmYS8ANcVUYv2yg8LdGpGwN3KYR)); 0.006 WETH reaches the
investor on Base, then 0.3 NEAR ([`2LFFGqVJ…`](https://testnet.nearblocks.io/txns/2LFFGqVJ3xhfZcX7cBtmGnpLhHqFUZfrJtzv5WihVSoN)).
A second run is the investor's own exit ([`H56zWCGx…`](https://testnet.nearblocks.io/txns/H56zWCGxrRSceS1CX34Z5ay2FkkPRzsUygBZH7MzX2a5)),
rescued by hand, each leg paid once.

Before the floor there is an earlier cut: [docs/results/delever](docs/results/delever/README.md). Under the
investor's $15 warning level, a guardian opened a deleverage; the judge planned a reduce-only sell from 0.01 to
0.0011 ETH, the investor's 0.2x target, and paid 0.1 NEAR only once a settled snapshot showed it
([`52X2qJsZ…`](https://testnet.nearblocks.io/txns/52X2qJsZPjz3oQamskBcRNYAv7hFJEByT7DCm956Dxe3)).

### 4. Try to break it (3 min)

[docs/try-to-break-it.md](docs/try-to-break-it.md): 20 bypass attempts against the live, locked judges, all refused
on chain. Among them: a forged snapshot claiming a $1M account, never attested because the MPC network found
no such log ([`4gcMUUad…`](https://testnet.nearblocks.io/txns/4gcMUUad8v7NE9jAXY6ppKMci1qyRLBrrm9RhB8kQBac)); an exit with
no trigger, refused `flatten-not-triggered` ([`5x4Jez8V…`](https://testnet.nearblocks.io/txns/5x4Jez8V76ZiYWtFkeZWX1asSTHLTvmHhQ6SR5q7PNYK));
the AI's own key calling `open_flatten`, rejected by NEAR before inclusion.

### 5. Inspect a strategy like a guardian (1 min)

The site's `/strategies/practice.keel-factory-bcf915.testnet` runs six checks live: created by the factory; no
keys; its code is the factory's; the Hyperliquid and Base accounts' controllers are the judge's MPC-derived keys
(so only it can sign for them); and both pay only the investor. By hand:

```bash
scripts/testnet/factory.sh verify practice      # needs Foundry's cast; reads only
```

### 6. Rescue it yourself (about 45 min, optional)

The practice strategy fails every day on purpose: its manager goes silent, and the mandate says a silent manager
means exit. From 14:40 to 17:40 UTC anyone may rescue it, and the judge pays whoever delivers. **Sends testnet
transactions from your own free account:**

```bash
git clone https://github.com/Femtech-web/Keel && cd Keel && npm ci
npx near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet create
make rescue ACCOUNT=<you>.testnet
```

What you sign and what the judge checks at each step: [docs/practice.md](docs/practice.md). Every cycle so far:
[docs/results/drill](docs/results/drill).

### 7. Rebuild it (10 min)

```bash
make test        # 127 tests: Rust rules and engine, Foundry, end to end through the judge, both NEAR contracts
make factory     # builds the judge and the factory and prints their sha256 (compare with step 2)
make web-test    # the site, with an accessibility audit of every page
```

The deployed builds are not reproducible across machines (`cargo near build non-reproducible-wasm` embeds
absolute paths); the archived sources rebuild to the deployed hashes at the original path
([g7](docs/results/g7/judge-source), [factory](docs/results/factory/source)).

### 8. What it does not do (2 min)

[docs/trust-model.md](docs/trust-model.md): what "no keys" means and does not mean, what NEAR's MPC network is
trusted for, and what could still go wrong.

## What this does not show

- One market: an ETH perpetual on Hyperliquid, with WETH on Base as the spot leg.
- NEAR's MPC network is trusted to sign and verify honestly; the trust model says where that applies.
- The replay is a counterfactual: Keel's rules applied to real fills, with the closing cost modelled.
- The daily drill and the courier run on GitHub Actions, with our testnet keys. The courier only pays gas; it cannot change anything the
  judge signs.
- The AI manager is Claude through its CLI, with no tools; every prompt and decision is logged with its run.
- Mainnet: only the privacy test ([docs/results/mainnet](docs/results/mainnet/README.md)): 2.799671 USDC into a
  NEAR Intents confidential balance. It hides the recipient and its balance, not the amount.
