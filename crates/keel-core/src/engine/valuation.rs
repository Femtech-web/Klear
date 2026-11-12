//! What the strategy is worth if it had to be closed now: the number the loss floor and the
//! leverage cap are checked against.
//!
//! liquidation value = perp account value + the leg's spot USDC - the cost of closing the perp
//!                     + the spot leg at the lower of oracle and mark, less a haircut
//!
//! - Perp account value is HyperCore's own margin summary: deposited margin plus unrealized PnL at
//!   the mark, net of funding already charged.
//! - The close cost is what the rescue's own order would give up: half the band (its limit offset
//!   from the mark) plus the taker fee, on the position's notional at the higher of oracle and mark.
//! - The spot leg (e.g. WETH on Base) is valued with the perp's prices for the same asset. Its
//!   quantity may come from an older reading (Base finality is ~20 min), which is safe: only the
//!   judge's signed exit can lower it. Its price always comes from the fresh perp snapshot.
//! - Not modelled: order-book depth beyond the band (the rescue retries in bounded steps instead),
//!   Base-side gas (paid by relayers), and price moves after the snapshot.

use super::{Evidence, Strategy};
use crate::evidence::PerpSnapshot;
use crate::px::{oracle_1e8, E8};
use crate::rules;
use crate::Error;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Valuation {
    /// HyperCore perp account value, USD x 1e6.
    pub perp_account_usd6: i64,
    /// The leg's HyperCore spot USDC, USD x 1e6.
    pub leg_spot_usdc_usd6: u64,
    /// Cost of closing the perp position at the rescue's limit offset plus fees, USD x 1e6.
    pub close_cost_usd6: u64,
    /// Spot leg quantity (1e8 per unit) and the price it is valued at (1e8 per unit, before the
    /// haircut).
    pub spot_qty_1e8: u64,
    pub spot_px_1e8: u64,
    pub spot_value_usd6: u64,
    pub total_usd6: i64,
    pub floor_usd6: u64,
    pub below_floor: bool,
}

impl Strategy {
    pub(crate) fn valuation(&self, ev: &Evidence) -> Result<Valuation, Error> {
        self.value(&ev.perp, ev.spot.balance)
    }

    /// The liquidation value of the strategy on this snapshot and spot balance.
    pub fn value(&self, s: &PerpSnapshot, spot_wei: u128) -> Result<Valuation, Error> {
        let p = self.policy();
        let oracle = oracle_1e8(s.oracle_raw, p.sz_decimals).filter(|o| *o > 0).ok_or(Error::BadPrice)? as u128;
        let mark = oracle_1e8(s.mark_raw, p.sz_decimals).filter(|m| *m > 0).ok_or(Error::BadPrice)? as u128;
        let usd6 = |qty_1e8: u128, px_1e8: u128| qty_1e8 * px_1e8 / E8 as u128 / 100;

        let perp_qty = self.perp_1e8(s.szi).unsigned_abs();
        let close_cost = rules::close_cost_usd6(usd6(perp_qty, mark.max(oracle)), p.band_bp, p.fee_bp);

        let spot_qty = self.spot_1e8(spot_wei) as u128;
        let spot_px = mark.min(oracle);
        let spot_value = usd6(spot_qty, spot_px) * (10_000 - p.spot_haircut_bp as u128) / 10_000;

        let leg_usdc = s.spot_usdc as u128 / 100;
        let total = s.account_value as i128 + leg_usdc as i128 - close_cost as i128 + spot_value as i128;
        let floor = p.equity_floor_usd6;
        Ok(Valuation {
            perp_account_usd6: s.account_value,
            leg_spot_usdc_usd6: leg_usdc as u64,
            close_cost_usd6: close_cost as u64,
            spot_qty_1e8: spot_qty as u64,
            spot_px_1e8: spot_px as u64,
            spot_value_usd6: spot_value as u64,
            total_usd6: total.clamp(i64::MIN as i128, i64::MAX as i128) as i64,
            floor_usd6: floor,
            below_floor: rules::below_floor(total, floor),
        })
    }
}
