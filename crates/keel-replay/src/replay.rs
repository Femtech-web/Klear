//! Keel's mandate applied to a real history, with the same functions the judge uses
//! (`keel_core::rules`). Two separate questions, never mixed into one counterfactual:
//! - **Leverage:** at each fill that adds exposure, would the judge have signed it? The path is the real one;
//!   we only count what the mandate would have refused.
//! - **Floor:** walking the real path, when does the liquidation value first fall below the floor, and what
//!   would a rescue then have returned? After that point the real agent kept trading; Keel would have stopped.

use crate::book::Book;
use crate::history::{History, Kind};
use keel_core::rules;
use serde::Serialize;

/// Keel's live policy: the rescue closes at half of a 100 bp band plus a 5 bp fee.
pub const BAND_BP: u16 = 100;
pub const FEE_BP: u16 = 5;

const fn usd6(x: f64) -> i128 {
    (x * 1e6) as i128
}

#[derive(Clone, Debug, Serialize)]
pub struct Refusal {
    pub time: u64,
    pub coin: String,
    pub leverage: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct LeverageCheck {
    pub cap_x: f64,
    /// Fills in the window that added exposure (the ones a mandate checks).
    pub opening_fills: usize,
    pub refused: usize,
    pub refused_share: f64,
    pub first_refusal: Option<Refusal>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Rescue {
    pub time: u64,
    pub value_usd: f64,
    pub gross_notional_usd: f64,
    pub close_cost_usd: f64,
    /// What the investor would have received: the value at the trigger less the rescue's close cost.
    pub returned_usd: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct FloorCheck {
    pub floor_pct: f64,
    pub floor_usd: f64,
    pub rescue: Option<Rescue>,
    /// What the investor would have had: the rescue, or the real final value if the floor never broke.
    pub investor_usd: f64,
    /// Against what the agent actually ended with (negative when the agent recovered after the trigger).
    pub saved_usd: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Check {
    pub time: u64,
    pub official_usd: f64,
    pub replay_usd: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub model: String,
    pub competition: String,
    pub address: String,
    pub source: String,
    pub start: u64,
    pub end: u64,
    pub initial_usd: f64,
    pub final_usd: f64,
    pub site_final_usd: Option<f64>,
    pub fills: usize,
    pub max_leverage: f64,
    /// Mean leverage over the opening fills.
    pub mean_leverage: f64,
    pub leverage: Vec<LeverageCheck>,
    pub floors: Vec<FloorCheck>,
    /// The reconstruction against Hyperliquid's own account-value history, inside the window.
    pub validation: Vec<Check>,
    /// The equity path, downsampled to at most `CURVE_POINTS` (time, USD): the last value in each time bucket.
    pub curve: Vec<(u64, f64)>,
}

pub const CURVE_POINTS: u64 = 240;

pub fn replay(h: &History, caps_x: &[f64], floors_pct: &[f64]) -> Report {
    let mut book = Book::default();
    let mut initial = None;
    let (mut fills, mut opens, mut lev_sum, mut lev_max) = (0usize, 0usize, 0.0f64, 0.0f64);
    let mut refused = vec![(0usize, None::<Refusal>); caps_x.len()];
    let mut rescues: Vec<Option<Rescue>> = vec![None; floors_pct.len()];
    let mut validation = Vec::new();
    let mut official = h.official.iter().filter(|(t, _)| *t > h.start && *t <= h.end).peekable();
    let mut last_equity = 0.0;
    let span = (h.end - h.start).max(1);
    let mut curve: Vec<(u64, f64)> = Vec::new();

    for e in &h.events {
        if e.time > h.end {
            break;
        }
        // Validate at the first event after each official point (the book has not changed since it).
        while let Some((t, v)) = official.peek() {
            if *t > e.time {
                break;
            }
            validation.push(Check { time: *t, official_usd: *v, replay_usd: last_equity });
            official.next();
        }
        let live = e.time >= h.start;
        match &e.kind {
            Kind::Transfer { usdc } => book.transfer(*usdc),
            Kind::Funding { usdc } => book.funding(*usdc),
            Kind::Fill { coin, px, signed_sz, start_pos, closed_pnl, fee } => {
                let before = book.equity();
                let (abs_before, abs_after) = book.fill(coin, *px, *signed_sz, *start_pos, *closed_pnl, *fee);
                if live {
                    fills += 1;
                    if abs_after > abs_before + 1e-12 {
                        opens += 1;
                        let gross = book.gross();
                        let lev = if before > 0.0 { gross / before } else { f64::INFINITY };
                        lev_sum += lev.min(1e6);
                        lev_max = lev_max.max(lev);
                        for (i, cap) in caps_x.iter().enumerate() {
                            if !rules::within_leverage(usd6(gross) as u128, usd6(before), (cap * 10_000.0) as u32) {
                                refused[i].0 += 1;
                                refused[i].1.get_or_insert(Refusal { time: e.time, coin: coin.clone(), leverage: lev });
                            }
                        }
                    }
                }
            }
        }
        if live && initial.is_none() {
            initial = Some(book.equity());
        }
        last_equity = book.equity();
        if live {
            let bucket = (e.time - h.start) * CURVE_POINTS / span;
            let bucket_time = h.start + bucket * span / CURVE_POINTS;
            match curve.last_mut() {
                Some(last) if last.0 == bucket_time => last.1 = last_equity,
                _ => curve.push((bucket_time, last_equity)),
            }
        }
        if let Some(init) = initial {
            for (i, pct) in floors_pct.iter().enumerate() {
                let floor = init * pct / 100.0;
                if rescues[i].is_none() && rules::below_floor(usd6(last_equity), usd6(floor) as u64) {
                    let gross = book.gross();
                    let cost = rules::close_cost_usd6(usd6(gross) as u128, BAND_BP, FEE_BP) as f64 / 1e6;
                    rescues[i] = Some(Rescue {
                        time: e.time,
                        value_usd: last_equity,
                        gross_notional_usd: gross,
                        close_cost_usd: cost,
                        returned_usd: (last_equity - cost).max(0.0),
                    });
                }
            }
        }
    }
    let initial = initial.unwrap_or(0.0);
    let final_usd = last_equity;
    Report {
        model: h.model.clone(),
        competition: h.competition.clone(),
        address: h.address.clone(),
        source: h.source.clone(),
        start: h.start,
        end: h.end,
        initial_usd: initial,
        final_usd,
        site_final_usd: h.site_final_usd,
        fills,
        max_leverage: lev_max,
        mean_leverage: if opens > 0 { lev_sum / opens as f64 } else { 0.0 },
        leverage: caps_x
            .iter()
            .zip(refused)
            .map(|(cap, (n, first))| LeverageCheck {
                cap_x: *cap,
                opening_fills: opens,
                refused: n,
                refused_share: if opens > 0 { n as f64 / opens as f64 } else { 0.0 },
                first_refusal: first,
            })
            .collect(),
        floors: floors_pct
            .iter()
            .zip(rescues)
            .map(|(pct, rescue)| {
                let investor = rescue.as_ref().map_or(final_usd, |r| r.returned_usd);
                FloorCheck { floor_pct: *pct, floor_usd: initial * pct / 100.0, investor_usd: investor, saved_usd: investor - final_usd, rescue }
            })
            .collect(),
        validation,
        curve,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::Event;

    fn fill(time: u64, px: f64, signed_sz: f64, start_pos: f64, closed_pnl: f64) -> Event {
        Event { time, kind: Kind::Fill { coin: "ETH".into(), px, signed_sz, start_pos, closed_pnl, fee: 0.0 } }
    }

    fn history(events: Vec<Event>) -> History {
        History {
            address: "0xabc".into(),
            model: "M".into(),
            competition: "C".into(),
            source: String::new(),
            site_final_usd: None,
            events,
            official: vec![(25, 7_000.0)],
            start: 1,
            end: 100,
        }
    }

    #[test]
    fn opening_fills_beyond_the_cap_are_refused_and_reductions_never_are() {
        let h = history(vec![
            Event { time: 1, kind: Kind::Transfer { usdc: 10_000.0 } },
            fill(10, 100.0, 200.0, 0.0, 0.0),   // 20,000 notional: 2x
            fill(20, 100.0, 300.0, 200.0, 0.0), // 50,000: 5x
            fill(30, 100.0, -400.0, 500.0, 0.0), // a reduction, always allowed
        ]);
        let r = replay(&h, &[3.0, 10.0], &[]);
        assert_eq!((r.leverage[0].opening_fills, r.leverage[0].refused), (2, 1));
        assert_eq!(r.leverage[0].first_refusal.as_ref().unwrap().time, 20);
        assert_eq!(r.leverage[1].refused, 0);
        assert!((r.max_leverage - 5.0).abs() < 1e-9);
    }

    #[test]
    fn the_floor_rescues_at_the_first_breach_and_compares_with_the_real_end() {
        let h = history(vec![
            Event { time: 1, kind: Kind::Transfer { usdc: 10_000.0 } },
            fill(10, 100.0, 100.0, 0.0, 0.0), // long 100 @ 100
            fill(20, 70.0, 1e-9, 100.0, 0.0), // price 70: equity 7,000 (the 70% floor is not broken)
            fill(30, 60.0, 1e-9, 100.0, 0.0), // price 60: equity 6,000 -> below 70%
            fill(40, 20.0, -100.0, 100.0, -8_000.0), // the real agent rode it down to 2,000
        ]);
        let r = replay(&h, &[], &[70.0]);
        let f = &r.floors[0];
        let rescue = f.rescue.as_ref().unwrap();
        assert_eq!(rescue.time, 30);
        assert!((rescue.close_cost_usd - 6_000.0 * 0.0055).abs() < 1e-6, "55 bp of the 6,000 notional");
        assert!((r.final_usd - 2_000.0).abs() < 1e-6);
        assert!((f.saved_usd - (6_000.0 - 33.0 - 2_000.0)).abs() < 1e-6);
        assert_eq!(r.validation.len(), 1, "the official point at t=25 is checked against the book then");
        assert!((r.validation[0].replay_usd - 7_000.0).abs() < 1e-6);
    }
}
