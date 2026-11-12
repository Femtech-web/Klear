# Alpha Arena, replayed through Keel

In Alpha Arena Season 1.5, AI models each traded $10,000 of real money on Hyperliquid. Their wallets are
public. We pulled every fill, funding payment and transfer of all 32 agents from Hyperliquid's public API,
rebuilt each account fill by fill, and applied Keel's mandate with the same functions the NEAR judge uses
(`keel_core::rules`). Policy reported here: **a 3x leverage cap and a floor 30% under the starting value**.

## What it shows

- The 32 agents started with $319,878 and ended with $176,849, after $144,527 of losses across the losing agents.
- **The floor** broke for 23 of them. A rescue at that moment would have left investors with **$233,621** in total instead of $176,849 ($56,772 better), 
  and was worse for 3 agents, which recovered after the trigger.
- **The leverage cap** would have refused 80235 of 116333 exposure-adding fills (69%).
- **Reconstruction check:** against Hyperliquid's own account-value points, the median error is 1.3% of the stake (per agent; worst 6.1%).

## Per agent (3x cap, floor at 70%)

| Model | Competition | Start | End (real) | Max lev. | Mean lev. | Refused at 3x | Floor broke | Investor with Keel | Saved |
|---|---|---|---|---|---|---|---|---|---|
| GROK-4 | 3: SITUATIONAL AWARENESS | $10,000 | $325 | 19.9x | 8.7x | 6475/7220 (90%) | 2025-11-20 20:50 | $6,801 | $6,475 |
| QWEN3-MAX | 3: SITUATIONAL AWARENESS | $9,994 | $1,232 | 20.0x | 5.9x | 5354/7485 (72%) | 2025-11-21 18:48 | $6,313 | $5,081 |
| GROK-4.20 | 4: MAX LEVERAGE | $10,007 | $1,650 | 16.9x | 9.9x | 471/585 (81%) | 2025-11-25 13:13 | $6,424 | $4,774 |
| CLAUDE-SONNET-4-5 | 3: SITUATIONAL AWARENESS | $10,005 | $2,135 | 16.9x | 4.6x | 4816/7554 (64%) | 2025-11-24 17:16 | $6,642 | $4,508 |
| CLAUDE-SONNET-4-5 | 4: MAX LEVERAGE | $10,013 | $2,605 | 11.3x | 4.0x | 748/1282 (58%) | 2025-11-24 18:36 | $6,899 | $4,294 |
| DEEPSEEK-CHAT-V3.1 | 4: MAX LEVERAGE | $9,977 | $2,762 | 18.8x | 10.2x | 1486/1618 (92%) | 2025-11-21 10:08 | $6,174 | $3,412 |
| GEMINI-3-PRO | 1: NEW BASELINE | $10,000 | $2,965 | 9.2x | 5.1x | 5163/5822 (89%) | 2025-11-23 21:32 | $6,656 | $3,691 |
| DEEPSEEK-CHAT-V3.1 | 3: SITUATIONAL AWARENESS | $9,900 | $2,957 | 19.6x | 7.8x | 6651/7509 (89%) | 2025-11-23 05:19 | $6,699 | $3,742 |
| GROK-4 | 4: MAX LEVERAGE | $9,977 | $3,435 | 13.6x | 8.8x | 1057/1148 (92%) | 2025-11-20 17:16 | $5,349 | $1,914 |
| KIMI-K2-THINKING | 3: SITUATIONAL AWARENESS | $9,996 | $3,537 | 14.5x | 4.0x | 4190/7123 (59%) | 2025-11-30 00:00 | $6,964 | $3,427 |
| KIMI-K2-THINKING | 1: NEW BASELINE | $10,000 | $3,637 | 12.5x | 4.4x | 2078/3384 (61%) | 2025-11-22 06:47 | $6,982 | $3,345 |
| GEMINI-3-PRO | 4: MAX LEVERAGE | $9,998 | $3,946 | 13.9x | 8.3x | 3436/3504 (98%) | 2025-11-24 17:51 | $6,195 | $2,249 |
| CLAUDE-SONNET-4-5 | 1: NEW BASELINE | $10,009 | $4,043 | 11.3x | 4.4x | 2536/3707 (68%) | 2025-11-25 14:43 | $6,749 | $2,706 |
| GEMINI-3-PRO | 3: SITUATIONAL AWARENESS | $10,000 | $4,202 | 10.2x | 6.3x | 5064/5510 (92%) | 2025-11-24 23:09 | $6,537 | $2,335 |
| DEEPSEEK-CHAT-V3.1 | 1: NEW BASELINE | $10,002 | $4,491 | 13.1x | 6.8x | 4026/4605 (87%) | 2025-11-21 15:36 | $5,474 | $983 |
| GROK-4 | 1: NEW BASELINE | $10,005 | $4,622 | 16.1x | 9.0x | 2273/2374 (96%) | 2025-11-24 14:35 | $6,211 | $1,589 |
| GROK-4 | 2: MONK MODE | $9,998 | $4,732 | 14.8x | 6.5x | 2276/2525 (90%) | 2025-11-24 00:40 | $6,570 | $1,838 |
| QWEN3-MAX | 1: NEW BASELINE | $10,001 | $5,806 | 9.9x | 3.3x | 2046/3672 (56%) | 2025-12-04 19:23 | $6,935 | $1,130 |
| KIMI-K2-THINKING | 4: MAX LEVERAGE | $10,003 | $6,019 | 19.7x | 7.0x | 1980/2395 (83%) | 2025-11-24 15:01 | $6,366 | $347 |
| GPT-5.1 | 3: SITUATIONAL AWARENESS | $10,001 | $6,319 | 10.4x | 2.8x | 1997/5182 (39%) | 2025-12-12 15:08 | $6,553 | $234 |
| CLAUDE-SONNET-4-5 | 2: MONK MODE | $10,000 | $6,930 | 7.9x | 3.6x | 346/592 (58%) | 2025-12-12 16:11 | $6,754 | -$175 |
| GPT-5.1 | 1: NEW BASELINE | $10,002 | $7,319 | 6.9x | 2.7x | 1160/3013 (38%) | 2025-12-12 17:47 | $6,827 | -$492 |
| QWEN3-MAX | 4: MAX LEVERAGE | $10,000 | $7,385 | 9.0x | 2.7x | 1704/4107 (41%) | 2025-11-25 14:32 | $6,750 | -$635 |
| KIMI-K2-THINKING | 2: MONK MODE | $10,000 | $8,239 | 11.8x | 2.0x | 846/3373 (25%) | no | $8,239 | $0 |
| GPT-5.1 | 2: MONK MODE | $10,001 | $8,250 | 4.9x | 1.7x | 159/1840 (9%) | no | $8,250 | $0 |
| GEMINI-3-PRO | 2: MONK MODE | $9,999 | $8,283 | 9.0x | 4.2x | 2555/3366 (76%) | no | $8,283 | $0 |
| GROK-4.20 | 1: NEW BASELINE | $9,999 | $8,848 | 17.7x | 6.4x | 1479/2165 (68%) | no | $8,848 | $0 |
| QWEN3-MAX | 2: MONK MODE | $10,000 | $9,273 | 4.9x | 1.4x | 289/2656 (11%) | no | $9,273 | $0 |
| GROK-4.20 | 2: MONK MODE | $10,001 | $9,444 | 7.8x | 1.0x | 36/526 (7%) | no | $9,444 | $0 |
| DEEPSEEK-CHAT-V3.1 | 2: MONK MODE | $9,999 | $9,970 | 11.9x | 4.3x | 4174/6116 (68%) | no | $9,970 | $0 |
| GPT-5.1 | 4: MAX LEVERAGE | $9,991 | $10,273 | 12.7x | 6.6x | 2660/3256 (82%) | no | $10,273 | $0 |
| GROK-4.20 | 3: SITUATIONAL AWARENESS | $9,999 | $11,216 | 12.3x | 4.6x | 704/1119 (63%) | no | $11,216 | $0 |

`summary.json` has every agent under every policy: caps of [2.0, 3.0, 5.0, 10.0]x and floors at [80.0, 70.0, 50.0]% of the start.

## Method

- **Data:** `scripts/replay/fetch.py` caches, unmodified, each wallet's ledger (`userNonFundingLedgerUpdates`), every fill
  (`userFillsByTime`), every funding payment (`userFunding`) and Hyperliquid's account-value history (`portfolio`)
  in `fixtures/replay/raw/`. The wallets come from each model's page on alphaarena.ai (`fixtures/replay/wallets.json`).
- **Window:** from the moment the $10,000 stake landed (net inflow first ≥ 90% of it) to the agent's last fill or the first
  withdrawal, whichever came first. Earlier test trades are replayed (so positions are right) but not judged.
- **Account:** cash moves by transfers, realized PnL and fees from each fill, and funding; positions by fills (Hyperliquid's
  `startPosition` is authoritative); equity is cash plus unrealized PnL at each coin's latest traded price.
- **Leverage:** at every fill that adds exposure, gross notional of all positions after it against equity before it,
  checked with `rules::within_leverage`, the judge's own check. Reductions are never refused.
- **Floor:** equity after every event, checked with `rules::below_floor`; the rescue returns the value at the first breach
  less `rules::close_cost_usd6` (half a 100 bp band plus 5 bp, Keel's live policy).

## Limits (read before quoting a number)

- **Two separate questions, not one simulation.** The refusals are counted on the real path; we do not re-simulate what
  the agent would have done instead. The floor rescue follows the real path up to the trigger and stops there.
- **Price between fills:** unrealized PnL uses each coin's latest fill price, so equity between that coin's trades is
  approximate; the reconstruction check above measures the result against Hyperliquid's own numbers.
- **Checked only at events:** a live guardian checks continuously, so a real trigger could only come earlier.
- **Execution:** the rescue's close cost assumes the book could absorb the close within half a band; very large or
  illiquid positions (some tokenized stocks) could cost more.
- **The site's own final values** (alphaarena.ai) are listed in `summary.json` next to ours; they may use a different end time.
