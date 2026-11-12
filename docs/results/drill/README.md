# The daily drill

The practice strategy (`practice.keel-factory-bcf915.testnet`, created through the factory) fails on purpose and
is rescued, as a recorded cycle: re-arm, fund, a manager that trades and then goes silent, the rescue, and each
reward paid only on delivery. [docs/practice.md](../../practice.md) explains the cycle and how to rescue it
yourself; the site's `/proof/drill` shows every cycle.

| File | What |
|---|---|
| `runs.jsonl` | one line per cycle: its result, who rescued it, what was delivered and paid, and every step with its transaction |
| `latest.json` | the latest line of `runs.jsonl`, pretty-printed |
| `cycle-<start>.jsonl` | one cycle's full step log, including the guardian's own steps (open, relays, settles, confirm) |
| `cycle-<start>.interrupted.jsonl` | a cycle cut off by its process ending (a closed session), before it could record a result |

A failed cycle is recorded with the step and the reason, and is not retried blindly. A drill started while a
rescue is already due finishes that rescue (it logs `resume`) instead of starting a new cycle.

## Notes from the first cycles (2026-11-12)

- The first run was interrupted when its session closed; the drill now runs as its own process.
- `rpc.testnet.near.org` began answering every call with 429 (`THIS ENDPOINT IS DEPRECATED`); all NEAR reads moved
  to FastNEAR.
- Cycle 1's manager order did not fill: its IOC sell was priced from the mark, which sat above the book's best
  bid. Its rescue therefore swept the margin and exited the vault with no position to close, like the G7
  investor-exit run. The drill now prices through the best bid, inside the judge's band, and retries once.
- A local network outage broke the first attempt at cycle 1's rescue after its trigger (recorded as failed);
  the resumed drill finished it.
