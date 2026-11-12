//! The mandate's arithmetic as pure functions: the engine checks every proposal with these, and the
//! Alpha Arena replay (`crates/keel-replay`) applies the very same functions to real AI trading history.
//! Amounts are USD x 1e6.

/// Whether a position of `notional` stays within `max_leverage_bp` of the liquidation `value`.
/// A non-positive value allows nothing.
pub fn within_leverage(notional_usd6: u128, value_usd6: i128, max_leverage_bp: u32) -> bool {
    value_usd6 > 0 && notional_usd6 * 10_000 <= value_usd6 as u128 * max_leverage_bp as u128
}

/// Whether the liquidation value is below the investor's floor (a floor of 0 is no floor).
pub fn below_floor(value_usd6: i128, floor_usd6: u64) -> bool {
    floor_usd6 > 0 && value_usd6 < floor_usd6 as i128
}

/// What the rescue's own close gives up: half the band (its limit offset from the mark) plus the fee.
pub fn close_cost_usd6(notional_usd6: u128, band_bp: u16, fee_bp: u16) -> u128 {
    notional_usd6 * ((band_bp / 2) as u128 + fee_bp as u128) / 10_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leverage_is_inclusive_and_needs_positive_value() {
        assert!(within_leverage(30_000_000, 30_000_000, 10_000), "exactly 1x is within 1x");
        assert!(!within_leverage(30_000_001, 30_000_000, 10_000));
        assert!(within_leverage(90_000_000, 30_000_000, 30_000), "3x");
        assert!(!within_leverage(1, 0, 100_000) && !within_leverage(1, -5, 100_000));
    }

    #[test]
    fn floor_and_close_cost() {
        assert!(below_floor(11_999_999, 12_000_000) && !below_floor(12_000_000, 12_000_000));
        assert!(!below_floor(-1, 0), "no floor");
        assert_eq!(close_cost_usd6(30_000_000, 100, 5), 165_000, "30 USD x 55 bp");
    }
}
