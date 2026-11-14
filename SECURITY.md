# Security

## Networks

Klear runs on testnets (NEAR testnet, Hyperliquid's HyperEVM testnet, Base Sepolia) with test funds. The only
exceptions are two authorized mainnet privacy tests with a few dollars of the author's own, recorded in
[docs/results/mandate](docs/results/mandate/README.md). Nothing here is audited: [docs/security-review.md](docs/security-review.md)
is an internal review, not an audit.

## Secrets

- Keys live outside the repository: NEAR and EVM keys in `.secrets/` (owner-only), account ids in `.env`, and NEAR
  CLI's keychain in `~/.near-credentials`. None is ever committed: a gitleaks pre-commit hook (`.githooks/`), a
  never-public paths check and a secret scan in CI refuse them.
- The AI manager holds only a NEAR function-call key, limited to `propose_order` and `heartbeat` on its judge with a
  0.5 NEAR allowance: it cannot withdraw, rescue or move funds.
- The daily drill's testnet keys reach GitHub's runner as one encrypted secret (`KEEL_DRILL_SECRETS`), unpacked with
  owner-only permissions and deleted when the run ends.
- The sealed strategy's text stays in `.secrets/`; only its decisions' signed receipts go on chain.
- Public by design: transactions, attestations, receipts and run records in `docs/results/`.

## What to read first

[docs/trust-model.md](docs/trust-model.md) (what you trust, what each failure would cost, and how to check it),
[docs/threat-model.md](docs/threat-model.md) (who could cheat, and what stops them), and
[docs/try-to-break-it.md](docs/try-to-break-it.md) (the live attempts, with the command to repeat each).

## Reporting a vulnerability

Open a private security advisory on this repository (Security → Report a vulnerability), or an issue without
details asking for a contact. We answer within a few days. If you break a live judge, the transaction is the best
report: please include it.
