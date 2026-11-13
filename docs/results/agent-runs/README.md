# Off-the-shelf agents, rescuing for pay (2026-11-13)

The claim: rescuing a Klear strategy is a job any AI agent can do with nothing but Klear's MCP tools and its own NEAR
account, and the judge pays it only when the money arrives. The test: Claude Code, unmodified, run headless
(`claude -p`) with **no built-in tools** (`--tools ""`; it tried `Read` once and was refused), only Klear's MCP
servers, and a NEAR testnet account the faucet created for it, `klear-agent-0f366c.testnet`. Its whole task:

> You are a guardian agent on NEAR testnet. Your account is klear-agent-0f366c.testnet and its key file is ….
> Using the Klear MCP tools: find a Klear strategy whose rescue is due, check it with inspect_strategy before acting,
> then run its rescue as your account. Follow it until both legs are delivered and you have been paid. Then report
> what happened: the strategy, the checks, each step, and what you were paid.

It was never told which strategy, when, or how. Each run's folder holds the task, the MCP configuration, Claude
Code's full transcript (`transcript.jsonl`, stream-json) and the rescue's log. Runner: [`agents/agent_run.py`](../../../agents/agent_run.py).

| Run | Strategy | What the agent did | Paid |
|---|---|---|---|
| [1](20261113-0957-practice) | practice (the daily drill's open window) | `list_strategies` → `inspect_strategy` → `rescue_status` → `start_rescue` → `wait_for_rescue`; restarted the rescue twice on its own | **nothing**: every attempt crashed on our HyperEVM log query (a 1,000-block range the public RPC times out on). The agent said so: "I didn't complete the rescue and wasn't paid … The rescue is still due and unclaimed." Fixed: 200-block ranges, retried. |
| [2](20261113-1003-practice) | practice (same window, rescue still due) | `list_strategies` → `inspect_strategy` (6 of 6) → `start_rescue` → `rescue_status` → `wait_for_rescue`; its session then ended on an Anthropic API error (403) during a 15-minute wait. A second session, told so, followed the same rescue: `rescue_status` → `rescue_log` → `wait_for_rescue` ×3 | **0.15 NEAR**: 0.1 for the Hyperliquid leg once 3.535075 USDC reached the investor, 0.05 for the Base leg once 0.004 WETH did |
| [3](20261113-1120-delever-sealed) | delever (its investor asked to exit, right after a sealed AI trade) | Used both servers, one session, 16 turns, 22 min. `list_strategies` → `inspect_strategy` (6 of 6) → `rescue_status` → `start_rescue`: **refused `attempt-not-resolved`**, because the sealed manager's order from a minute earlier was still open. On its own it read `rescue_log`, checked the hosted `rescue_status` and `how_to_rescue`, then started again once the order expired: opened → `wait_for_rescue` ×4 | **0.15 NEAR**: 0.1 once 3.5 USDC reached the investor, 0.05 once 0.004 WETH did |

## Run 2, on chain

| Step | Transaction |
|---|---|
| The agent's account attests a snapshot and opens the rescue (job 3, held by the agent) | [`GRJS45ri…`](https://testnet.nearblocks.io/txns/GRJS45ritaPBNABBgcubpFXj3AF2EYG4xUbwLpcjFooD) |
| The courier relays the close, the vault's exit and the sweep | HyperEVM `0x7d79b6c5…`, Base `0x60b486f8…`, HyperEVM `0x536855fd…` |
| Settle; settle: **3.535075 USDC at the investor, 0.1 NEAR to the agent** | [`38NrVzGW…`](https://testnet.nearblocks.io/txns/38NrVzGWe9GLucuh3udLF46CjavYpad55MoCFWjyTSHg), [`DWUmFFFm…`](https://testnet.nearblocks.io/txns/DWUmFFFmwvoeqcDQHWkxtkBMFULPnJw3WXXwGjXuhaKf) |
| Confirm the vault's exit: **0.004 WETH at the investor, 0.05 NEAR to the agent**; the strategy is closed | [`A42tqkXX…`](https://testnet.nearblocks.io/txns/A42tqkXXGY5jQvoCUoT1vqbzpLJJcX7syLgpQNdd9eag) |

The agent's own report (second session, final message): "The rescue of `practice.keel-factory-bcf915.testnet` is
finished. Both legs reached the investor and the judge paid `klear-agent-0f366c.testnet` **0.15 NEAR** in total."

## Run 3, on chain

The strategy had just traded under a sealed manager (its decision made in a TEE, its receipt on chain:
[sealed](../sealed/README.md)); then its investor asked to exit and Claude Code was started.

| Step | Transaction |
|---|---|
| The investor asks to exit | [`AaysfJw3…`](https://testnet.nearblocks.io/txns/AaysfJw3Mc9eV8u6kkVEfmetAWsp2uDZTkLYojSRAuy) |
| The agent's first open, **refused**: the sealed order (nonce 5) was not resolved yet | [`4iuTPy4z…`](https://testnet.nearblocks.io/txns/4iuTPy4zXMxBN4rdhEknCukpiUyPxza32M7PYthSQdXw) |
| Its second open, after the order's deadline: job 4, held by the agent | [`8MQUDwMG…`](https://testnet.nearblocks.io/txns/8MQUDwMGPGP4vjMdq1UXGJ3vdZrcoPj9AWXPwjsSNmKf) |
| The courier relays the vault's exit and the sweep | Base `0xec800c8a…` |
| Settle: **3.5 USDC at the investor, 0.1 NEAR to the agent** | [`8gvLeoRd…`](https://testnet.nearblocks.io/txns/8gvLeoRdpGFFTmjH47oe4Kbd9rZgYwmf8QfCeCb4M5Bj) |
| Confirm the vault's exit: **0.004 WETH at the investor, 0.05 NEAR to the agent**; the strategy is flat | [`69F4qoep…`](https://testnet.nearblocks.io/txns/69F4qoepDZbn3GB1Fv68CHrKgnsZkqKgh8K1WjmoTpde) |

From its report: "I chose no order, price or destination: the judge planned the orders and only sent money to the
investor's fixed addresses. The courier paid the EVM gas."

## What else these runs found

- The daily drill on GitHub Actions crashed during this window: a courier transaction came back without a status
  field. The drill now logs a failed courier round and tries again, and `send_tx` fails with the reply instead. A
  local courier carried the gas for the rest of the window; anyone may run one.
- `wait_for_rescue` now waits at most 5 minutes per call, so an agent's session never idles 15 minutes.

## What this does not show

Three runs, not sixteen: two paid, one failed on our own RPC query (fixed), plus the stranger's manual rescue
([visitor](../visitor/README.md)). Each run needs a strategy whose rescue is due, and a Base exit takes about 25
minutes to finalize, so runs are slow to repeat; `agents/agent_run.py` records each.
