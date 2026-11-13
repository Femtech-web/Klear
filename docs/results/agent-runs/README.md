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

## Run 2, on chain

| Step | Transaction |
|---|---|
| The agent's account attests a snapshot and opens the rescue (job 3, held by the agent) | [`GRJS45ri…`](https://testnet.nearblocks.io/txns/GRJS45ritaPBNABBgcubpFXj3AF2EYG4xUbwLpcjFooD) |
| The courier relays the close, the vault's exit and the sweep | HyperEVM `0x7d79b6c5…`, Base `0x60b486f8…`, HyperEVM `0x536855fd…` |
| Settle; settle: **3.535075 USDC at the investor, 0.1 NEAR to the agent** | [`38NrVzGW…`](https://testnet.nearblocks.io/txns/38NrVzGWe9GLucuh3udLF46CjavYpad55MoCFWjyTSHg), [`DWUmFFFm…`](https://testnet.nearblocks.io/txns/DWUmFFFmwvoeqcDQHWkxtkBMFULPnJw3WXXwGjXuhaKf) |
| Confirm the vault's exit: **0.004 WETH at the investor, 0.05 NEAR to the agent**; the strategy is closed | [`A42tqkXX…`](https://testnet.nearblocks.io/txns/A42tqkXXGY5jQvoCUoT1vqbzpLJJcX7syLgpQNdd9eag) |

The agent's own report (second session, final message): "The rescue of `practice.keel-factory-bcf915.testnet` is
finished. Both legs reached the investor and the judge paid `klear-agent-0f366c.testnet` **0.15 NEAR** in total."

## What else these runs found

- The daily drill on GitHub Actions crashed during this window: a courier transaction came back without a status
  field. The drill now logs a failed courier round and tries again, and `send_tx` fails with the reply instead. A
  local courier carried the gas for the rest of the window; anyone may run one.
- `wait_for_rescue` now waits at most 5 minutes per call, so an agent's session never idles 15 minutes.

## What this does not show

Not 16 runs yet: two here, one paid, plus the stranger's manual rescue ([visitor](../visitor/README.md)). Every
daily drill window is another chance, and `agents/agent_run.py` records each.
