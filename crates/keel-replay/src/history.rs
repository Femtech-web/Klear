//! One agent's real history, as Hyperliquid's public API returned it (cached unmodified in
//! `fixtures/replay/raw/<address>.json` by `scripts/replay/fetch.py`), as a single time-ordered stream.

use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// One fill. `signed_sz` is positive for a buy. `start_pos` is Hyperliquid's own position before it.
    Fill { coin: String, px: f64, signed_sz: f64, start_pos: f64, closed_pnl: f64, fee: f64 },
    /// A funding payment (negative = paid).
    Funding { usdc: f64 },
    /// USDC into (positive) or out of (negative) the account.
    Transfer { usdc: f64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub time: u64,
    pub kind: Kind,
}

#[derive(Clone, Debug)]
pub struct History {
    pub address: String,
    pub model: String,
    pub competition: String,
    pub source: String,
    /// The final account value the competition's site publishes for this agent.
    pub site_final_usd: Option<f64>,
    pub events: Vec<Event>,
    /// Hyperliquid's own account-value history (coarse), for validating the reconstruction.
    pub official: Vec<(u64, f64)>,
    /// When the competition stake had landed (net inflow first reached 90% of it).
    pub start: u64,
    /// The last fill, or the first withdrawal after the start's first day, whichever is earlier.
    pub end: u64,
}

fn num(v: &Value) -> f64 {
    match v {
        Value::String(s) => s.parse().unwrap_or(0.0),
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// A ledger entry's effect on this account's USDC, if it moves any in or out (internal moves between
/// this account's own balances, such as spot/perp or dex abstraction, change nothing).
fn transfer(delta: &Value, me: &str) -> Option<f64> {
    let to_me = delta["destination"].as_str().is_some_and(|d| d.eq_ignore_ascii_case(me));
    let from_me = delta["user"].as_str().is_some_and(|u| u.eq_ignore_ascii_case(me));
    let signed = |x: f64| if to_me && !from_me { Some(x) } else if from_me && !to_me { Some(-x) } else { None };
    match delta["type"].as_str()? {
        "send" | "spotTransfer" => signed(num(&delta["usdcValue"]).max(if delta["token"] == "USDC" { num(&delta["amount"]) } else { 0.0 })),
        "subAccountTransfer" => signed(num(&delta["usdc"])),
        "deposit" => Some(num(&delta["usdc"])),
        "withdraw" => Some(-(num(&delta["usdc"]) + num(&delta["fee"]))),
        _ => None,
    }
}

pub fn parse(raw: &Value, stake_usd: f64) -> Result<History, String> {
    let w = &raw["wallet"];
    let me = w["address"].as_str().ok_or("wallet.address")?.to_lowercase();
    let mut events = Vec::new();
    for e in raw["ledger"].as_array().ok_or("ledger")? {
        if let Some(usdc) = transfer(&e["delta"], &me) {
            events.push(Event { time: e["time"].as_u64().unwrap_or(0), kind: Kind::Transfer { usdc } });
        }
    }
    for f in raw["fills"].as_array().ok_or("fills")? {
        let sz = num(&f["sz"]);
        events.push(Event {
            time: f["time"].as_u64().unwrap_or(0),
            kind: Kind::Fill {
                coin: f["coin"].as_str().unwrap_or("?").to_string(),
                px: num(&f["px"]),
                signed_sz: if f["side"] == "B" { sz } else { -sz },
                start_pos: num(&f["startPosition"]),
                closed_pnl: num(&f["closedPnl"]),
                fee: if f["feeToken"] == "USDC" || f["feeToken"].is_null() { num(&f["fee"]) } else { 0.0 },
            },
        });
    }
    for f in raw["funding"].as_array().ok_or("funding")? {
        events.push(Event { time: f["time"].as_u64().unwrap_or(0), kind: Kind::Funding { usdc: num(&f["delta"]["usdc"]) } });
    }
    // Stable order: transfers before fills before funding at the same millisecond.
    let rank = |k: &Kind| match k {
        Kind::Transfer { .. } => 0,
        Kind::Fill { .. } => 1,
        Kind::Funding { .. } => 2,
    };
    events.sort_by_key(|e| (e.time, rank(&e.kind)));

    let mut net = 0.0;
    let start = events
        .iter()
        .find_map(|e| match e.kind {
            Kind::Transfer { usdc } => {
                net += usdc;
                (net >= 0.9 * stake_usd).then_some(e.time)
            }
            _ => None,
        })
        .ok_or("the competition stake never landed")?;
    let last_fill = events.iter().rev().find(|e| matches!(e.kind, Kind::Fill { .. })).map(|e| e.time).ok_or("no fills")?;
    // Outflows within a day of the stake are funding corrections (a duplicate deposit returned, say): they
    // are booked as cash but do not end the window. The cash-out after the competition does.
    const DAY_MS: u64 = 86_400_000;
    let first_out = events
        .iter()
        .find(|e| e.time > start + DAY_MS && matches!(e.kind, Kind::Transfer { usdc } if usdc < 0.0))
        .map(|e| e.time);
    let end = first_out.map_or(last_fill, |t| t.min(last_fill));
    let official = raw["portfolio_all_time"]
        .as_array()
        .map(|a| a.iter().map(|p| (p[0].as_u64().unwrap_or(0), num(&p[1]))).collect())
        .unwrap_or_default();
    Ok(History {
        address: me,
        model: w["model"].as_str().unwrap_or("?").to_string(),
        competition: w["competition"].as_str().unwrap_or("?").to_string(),
        source: w["source"].as_str().unwrap_or("").to_string(),
        site_final_usd: w["site_final_value_usd"].as_f64(),
        events,
        official,
        start,
        end,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transfers_are_signed_from_the_accounts_side_and_internal_moves_ignored() {
        let me = "0xabc";
        assert_eq!(transfer(&json!({"type":"send","user":"0xdef","destination":"0xABC","token":"USDC","amount":"50.0","usdcValue":"50.0"}), me), Some(50.0));
        assert_eq!(transfer(&json!({"type":"send","user":"0xabc","destination":"0xdef","token":"USDC","amount":"5","usdcValue":"5"}), me), Some(-5.0));
        assert_eq!(transfer(&json!({"type":"subAccountTransfer","user":"0xdef","destination":"0xabc","usdc":"1.5"}), me), Some(1.5));
        assert_eq!(transfer(&json!({"type":"activateDexAbstraction","dex":"xyz","token":"USDC","amount":"48"}), me), None);
        assert_eq!(transfer(&json!({"type":"withdraw","usdc":"10","fee":"1"}), me), Some(-11.0));
    }

    #[test]
    fn the_window_opens_when_the_stake_lands_and_closes_at_the_first_withdrawal() {
        let raw = json!({
            "wallet": {"address": "0xabc", "model": "M", "competition": "C", "site_final_value_usd": 5.0},
            "ledger": [
                {"time": 1, "delta": {"type":"send","user":"0xf","destination":"0xabc","token":"USDC","amount":"100","usdcValue":"100"}},
                {"time": 5, "delta": {"type":"send","user":"0xf","destination":"0xabc","token":"USDC","amount":"9900","usdcValue":"9900"}},
                {"time": 6, "delta": {"type":"send","user":"0xabc","destination":"0xf","token":"USDC","amount":"10","usdcValue":"10"}},
                {"time": 86_400_050, "delta": {"type":"send","user":"0xabc","destination":"0xf","token":"USDC","amount":"10","usdcValue":"10"}}
            ],
            "fills": [
                {"time": 3, "coin":"ETH","px":"10","sz":"1","side":"B","startPosition":"0","closedPnl":"0","fee":"0","feeToken":"USDC"},
                {"time": 86_400_060, "coin":"ETH","px":"10","sz":"1","side":"A","startPosition":"1","closedPnl":"0","fee":"0","feeToken":"USDC"}
            ],
            "funding": [], "portfolio_all_time": [[5, "10000.0"]]
        });
        let h = parse(&raw, 10_000.0).unwrap();
        assert_eq!((h.start, h.end), (5, 86_400_050), "the correction at t=6 does not end the window");
        assert_eq!(h.events.len(), 6);
    }
}
