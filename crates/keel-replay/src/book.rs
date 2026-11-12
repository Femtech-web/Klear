//! The account, rebuilt the way Hyperliquid accounts for it: cash moves by transfers, realized PnL,
//! fees and funding; positions move by fills; equity is cash plus unrealized PnL at the latest traded
//! price of each coin (the replay's stand-in for the mark).

use std::collections::BTreeMap;

#[derive(Clone, Debug, Default)]
pub struct Book {
    pub cash: f64,
    /// coin -> (signed size, average entry price)
    pos: BTreeMap<String, (f64, f64)>,
    px: BTreeMap<String, f64>,
}

impl Book {
    pub fn transfer(&mut self, usdc: f64) {
        self.cash += usdc;
    }

    /// Applies a fill and returns the coin's absolute size before and after it. Hyperliquid's own
    /// `start_pos` is authoritative for the size before.
    pub fn fill(&mut self, coin: &str, px: f64, signed_sz: f64, start_pos: f64, closed_pnl: f64, fee: f64) -> (f64, f64) {
        let entry = self.pos.get(coin).map_or(px, |p| p.1);
        let next = start_pos + signed_sz;
        let entry = if start_pos == 0.0 || (next != 0.0 && next.signum() != start_pos.signum()) {
            px // opened, or flipped: what remains was opened at this price
        } else if next.abs() > start_pos.abs() {
            (entry * start_pos.abs() + px * signed_sz.abs()) / next.abs()
        } else {
            entry
        };
        if next.abs() < 1e-12 {
            self.pos.remove(coin);
        } else {
            self.pos.insert(coin.to_string(), (next, entry));
        }
        self.px.insert(coin.to_string(), px);
        self.cash += closed_pnl - fee;
        (start_pos.abs(), next.abs())
    }

    pub fn funding(&mut self, usdc: f64) {
        self.cash += usdc;
    }

    pub fn equity(&self) -> f64 {
        self.cash + self.pos.iter().map(|(c, (sz, entry))| sz * (self.px[c] - entry)).sum::<f64>()
    }

    /// Gross notional of every open position.
    pub fn gross(&self) -> f64 {
        self.pos.iter().map(|(c, (sz, _))| sz.abs() * self.px[c]).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equity_is_cash_plus_unrealized_and_realized_pnl_comes_from_the_fill() {
        let mut b = Book::default();
        b.transfer(1_000.0);
        b.fill("ETH", 100.0, 2.0, 0.0, 0.0, 0.1); // long 2 @ 100
        assert!((b.equity() - 999.9).abs() < 1e-9);
        b.fill("ETH", 110.0, 2.0, 2.0, 0.0, 0.1); // long 4, entry 105
        assert!((b.equity() - (999.8 + 4.0 * 5.0)).abs() < 1e-9);
        assert!((b.gross() - 440.0).abs() < 1e-9);
        b.fill("ETH", 120.0, -4.0, 4.0, 60.0, 0.1); // closed: +60 realized
        assert!((b.equity() - 1_059.7).abs() < 1e-9);
        assert_eq!(b.gross(), 0.0);
    }

    #[test]
    fn a_flip_reopens_the_remainder_at_the_fill_price() {
        let mut b = Book::default();
        b.fill("BTC", 50.0, 1.0, 0.0, 0.0, 0.0);
        b.fill("BTC", 60.0, -3.0, 1.0, 10.0, 0.0); // now short 2 @ 60
        b.fill("BTC", 55.0, 0.000001, -2.0, 0.0, 0.0); // a tiny buy updates the price
        assert!((b.equity() - (10.0 + 2.0 * 5.0)).abs() < 1e-3);
    }
}
