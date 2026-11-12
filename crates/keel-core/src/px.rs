//! Hyperliquid perp price and size units. CoreWriter takes 1e8 x human values; the oracle
//! precompile returns human x 10^(6 - szDecimals); `szi` is human x 10^szDecimals.

pub const E8: u64 = 100_000_000;

pub fn oracle_1e8(raw: u64, sz_decimals: u8) -> Option<u64> {
    raw.checked_mul(10u64.pow(2 + sz_decimals as u32))
}

pub fn lot(sz_decimals: u8) -> u64 {
    10u64.pow(8 - sz_decimals as u32)
}

fn tick(sz_decimals: u8) -> u64 {
    10u64.pow(2 + sz_decimals as u32)
}

/// At most 6 - szDecimals decimals, and at most 5 significant figures unless an integer.
pub fn valid_px(px: u64, sz_decimals: u8) -> bool {
    if px == 0 || px % tick(sz_decimals) != 0 {
        return false;
    }
    if px % E8 == 0 {
        return true;
    }
    let mut v = px;
    while v % 10 == 0 {
        v /= 10;
    }
    v.to_string().len() <= 5
}

/// The nearest valid price at or above (`up`) or at or below `px`.
pub fn round_px(px: u64, sz_decimals: u8, up: bool) -> Option<u64> {
    let digits = px.to_string().len() as u32;
    let sig_step = if digits > 5 { 10u64.pow(digits - 5) } else { 1 };
    let step = sig_step.max(tick(sz_decimals)).min(E8);
    let down = px / step * step;
    let r = if up && down != px { down.checked_add(step)? } else { down };
    valid_px(r, sz_decimals).then_some(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_keelleg_valid_px() {
        assert!(valid_px(2970 * E8, 4));
        assert!(valid_px(297_050_000_000, 4));
        assert!(!valid_px(297_055_000_000, 4));
        assert!(!valid_px(297_055_500_000, 4));
        assert!(valid_px(123_456 * E8, 4));
    }

    #[test]
    fn rounding_stays_valid_and_on_the_right_side() {
        // 2049.3 x 0.99 = 2028.807
        let low = 202_880_700_000;
        assert_eq!(round_px(low, 4, true), Some(202_890_000_000));
        assert_eq!(round_px(low, 4, false), Some(202_880_000_000));
        assert_eq!(round_px(999_995_000_000, 4, true), Some(1_000_000_000_000));
        for p in [1u64, 12_345_678, 202_880_700_001, 3_030 * E8, 99_999_999_999] {
            for up in [true, false] {
                if let Some(r) = round_px(p, 4, up) {
                    assert!(valid_px(r, 4));
                    assert!(if up { r >= p } else { r <= p });
                }
            }
        }
    }

    #[test]
    fn scales() {
        assert_eq!(oracle_1e8(204_930, 4), Some(204_930_000_000));
        assert_eq!(lot(4), 10_000);
    }
}
