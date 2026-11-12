# The rescue, the valuation and the failure cases

Evidence levels used below: **live** (a testnet transaction in `docs/results/`), **tested** (local tests; the
Hyperliquid side is simulated), **design** (built, not yet exercised live), **limit** (known gap).

## When an exit may open

`exit_trigger` (`engine/mandate.rs`) allows an exit for exactly four reasons, recorded on the strategy:

| Trigger | Who causes it | Evidence the judge checks |
|---|---|---|
| `investor` | the investor's NEAR account calls `request_exit` | the caller (no one else, not even the deployer) |
| `floor` | losses | liquidation value below `equity_floor_usd6` on a fresh attested snapshot |
| `manager-silent` | the manager stops sending heartbeats | NEAR block time past `last_heartbeat + heartbeat_s`, **only if** the investor chose `on_silence: exit` |
| `repair-exhausted` | hedge repair failed within its bounds | the judge's own state |

Silence alone is not evidence of danger, so `on_silence` defaults to `nothing`; the investor opts in.
Once triggered, an exit stays triggered until both legs are done. The manager cannot propose during it, and
the manager's own account cannot be a guardian (it could otherwise lose money on purpose and then collect
the reward; a manager with a second account could still try, which is why rewards are small and bounded).

## The two legs

The legs run independently. A stuck asset on one never holds back the other (**the live G6 failure**: the
old judge only swept USDC after both legs were empty, and a Base token that could not move froze both).

**Perp leg (Hyperliquid).** Reduce-only IOC closes, planned by the judge at half the band from the mark,
sized by the per-order cap and a loss budget, until the position is at dust. Then one `sweep` of everything
on the leg (perp margin plus any spot USDC) to `KeelLeg.payout`, which is immutable. When the first sweep is
signed the judge records what the leg held and the payout's balance then (`Owed`).
- **Delivered** when a settled snapshot shows the leg empty *and* the payout's spot USDC up by at least
  `Owed.usdc_wei - usdc_dust`. KeelLeg v6 snapshots carry the payout's balance (precompile `0x801`) for this.
- **Unverified** when the leg empties but the payout does not show the arrival: no reward. **Empty** when
  there was nothing to sweep (a liquidated account): no reward. A liquidation is not a rescue.

**Spot leg (Base).** One `KeelVault.exit`: the vault's whole balance of the spot token to its immutable
payout, in a single call that reverts entirely if the transfer fails.
- **Delivered** when the vault's `Exited` receipt for the nonce the judge signed is attested by Read MPC
  (`confirm_exit`); it names the token, the payout and the amount.

Each leg's reward (`flatten_reward` for the perp leg, `spot_reward` for the spot leg) is reserved when a job
opens and paid once, to the job's agent, at delivery. Unpaid reserves return to the pool.

## Failure cases

| Case | What happens | Level |
|---|---|---|
| Close order not relayed | It expires; the next step re-plans it; it never counted as a failure | tested |
| Partial fill | The next close is for what remains; `max_failed_attempts` closes, then the job ends and any guardian may continue with a fresh job | tested |
| Order fill larger than signed, or a flip | Strategy freezes (no signed order explains it) | tested |
| Position shrank without an order (ADL, liquidation) | Job voided; the exit stays open | tested |
| Sweep's spot send fails on HyperCore | USDC stays on the leg; the next step signs a sweep of what is left; paid only on arrival | tested (sim + e2e) |
| Token frozen / transfer reverts on Base | Exit reverts, vault nonce unchanged, nothing spent; the same signature works later, or a new one (same nonce) after a reading past the old deadline | tested |
| Base transfer mined but reverted (EOA design) | **The G6 bug.** Fixed: the vault has its own nonce and reverts atomically | live (G6), fixed by design |
| Two signatures for one vault nonce | At most one can execute; all of them pay the same payout | tested |
| Guardian disappears | Job expires (`job_ttl_s`); the exit stays triggered; another guardian opens a job and continues exactly where it stopped | tested |
| Someone races a guardian's evidence | The judge only lets the account that attested a snapshot open a job on it | tested (contract) |
| Duplicate claims, replays | Evidence is used once; receipts must match the signed nonce; finished legs pay nothing | tested |
| Funds arriving after the rescue | `sweep` sends them on (either leg), no reward | tested |
| Gas | Relayers pay on every chain; the vault needs no ETH; a stuck transaction is just a signature someone resubmits | design |

## Order of the legs, and exposure while they move

The exit never sells the spot asset; it delivers it in kind. Closing the perp and moving WETH happen in
parallel and the investor ends with WETH plus USDC. If the perp is a hedge for the WETH, the window between
the two steps leaves either the investor holding WETH while the short is still open (still hedged) or the
WETH still in the vault after the short closed (long WETH, exactly the exposure the investor owns anyway).
No ordering creates exposure the investor did not already have. **Limit:** a strategy whose spot asset is
not the perp's underlying would need its own analysis.

## The liquidation value (the floor and the leverage cap)

`engine/valuation.rs`, exposed live by the judge's `valuation(perp, spot)` view so guardians, the manager
and the investor act on the same numbers:

```
value = perp account value                      (HyperCore margin summary: margin + unrealized PnL at mark)
      + the leg's HyperCore spot USDC
      - close cost  = |position| x max(oracle, mark) x (band/2 + taker fee)
      + spot value  = vault balance x min(oracle, mark) x (1 - haircut)
```

Worked example (an engine test): 25 USD account value, 2 USD spot USDC, a 0.01 ETH short, oracle 3000,
mark 2950, 0.01 WETH, 1% haircut, 100 bp band, 5 bp fee:
`25 + 2 - 0.165 + 29.205 = 56.04 USD`.

- **Freshness.** The perp snapshot must be younger than `max_perp_age_s` (300 s live). The vault reading may
  be up to `max_evidence_age_s` (1 h) old because Base needs ~20 minutes to finalize. That is safe for the
  quantity (only the judge's signed exit can lower it) and the price always comes from the fresh snapshot.
- **Correlation.** WETH on Base is valued with Hyperliquid's ETH prices; the haircut covers the venue gap.
- **Hedged positions.** A short against WETH nets out naturally: the short's loss shows in the account value,
  the WETH's gain in the spot value.
- **Not modelled (limit):** order-book depth beyond the band (the rescue closes in bounded steps instead),
  funding still to be charged, and price moves after the snapshot.

## Not built yet

Early-warning deleveraging (a bounded reduce-only job when value nears the floor) is the next step on the
same order machinery. As you asked, it waits until the live rescue on the replacement judge has passed.
