//! Replays Alpha Arena's AI agents' real Hyperliquid history through Klear's mandate rules.
//!
//!   cargo run -p keel-replay --release -- [fixtures/replay/raw] [docs/results/replay]
//!
//! Reads every `<address>.json.gz` that `scripts/replay/fetch.py` cached.
//!
//! Writes `summary.json` (every number, per agent and per policy) and `README.md` (the findings, the
//! method and its limits).

mod book;
mod history;
mod replay;

use replay::{replay, Report};
use serde_json::{json, Value};
use std::fmt::Write as _;
use std::fs;
use std::io::Read as _;
use std::path::Path;

const STAKE_USD: f64 = 10_000.0;
const CAPS_X: [f64; 4] = [2.0, 3.0, 5.0, 10.0];
const FLOORS_PCT: [f64; 3] = [80.0, 70.0, 50.0];
/// The policy the headline reports: a 3x leverage cap and a floor 30% under the starting value.
const HEADLINE: (usize, usize) = (1, 1);

fn date(ms: u64) -> String {
    // Civil date from days since the epoch (Howard Hinnant's algorithm), UTC.
    let secs = ms / 1000;
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", secs % 86_400 / 3600, secs % 3600 / 60)
}

fn usd(x: f64) -> String {
    let neg = x < 0.0;
    let s = format!("{:.0}", x.abs());
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{}${out}", if neg { "-" } else { "" })
}

fn validation_error(r: &Report) -> Option<f64> {
    // Median absolute error against Hyperliquid's own points, as a share of the starting value.
    let mut e: Vec<f64> = r.validation.iter().map(|c| (c.replay_usd - c.official_usd).abs() / r.initial_usd.max(1.0)).collect();
    e.sort_by(|a, b| a.total_cmp(b));
    (!e.is_empty()).then(|| e[e.len() / 2])
}

fn markdown(reports: &[Report]) -> String {
    let (c, f) = HEADLINE;
    let mut s = String::new();
    let lost: f64 = reports.iter().map(|r| r.initial_usd - r.final_usd).filter(|x| *x > 0.0).sum();
    let start: f64 = reports.iter().map(|r| r.initial_usd).sum();
    let end: f64 = reports.iter().map(|r| r.final_usd).sum();
    let with_keel: f64 = reports.iter().map(|r| r.floors[f].investor_usd).sum();
    let hit = reports.iter().filter(|r| r.floors[f].rescue.is_some()).count();
    let worse = reports.iter().filter(|r| r.floors[f].saved_usd < 0.0).count();
    let opens: usize = reports.iter().map(|r| r.leverage[c].opening_fills).sum();
    let refused: usize = reports.iter().map(|r| r.leverage[c].refused).sum();
    let errors: Vec<f64> = reports.iter().filter_map(validation_error).collect();

    let _ = writeln!(s, "# Alpha Arena, replayed through Klear\n");
    let _ = writeln!(s, "In Alpha Arena Season 1.5, AI models each traded $10,000 of real money on Hyperliquid. Their wallets are");
    let _ = writeln!(s, "public. We pulled every fill, funding payment and transfer of all {} agents from Hyperliquid's public API,", reports.len());
    let _ = writeln!(s, "rebuilt each account fill by fill, and applied Klear's mandate with the same functions the NEAR judge uses");
    let _ = writeln!(s, "(`keel_core::rules`). Policy reported here: **a 3x leverage cap and a floor 30% under the starting value**.\n");
    let _ = writeln!(s, "## What it shows\n");
    let _ = writeln!(s, "- The {} agents started with {} and ended with {}, after {} of losses across the losing agents.", reports.len(), usd(start), usd(end), usd(lost));
    let _ = writeln!(s, "- **The floor** broke for {hit} of them. A rescue at that moment would have left investors with **{}** in total instead of {} ({} better), ", usd(with_keel), usd(end), usd(with_keel - end));
    let _ = writeln!(s, "  and was worse for {worse} agents, which recovered after the trigger.");
    let _ = writeln!(s, "- **The leverage cap** would have refused {refused} of {opens} exposure-adding fills ({:.0}%).", 100.0 * refused as f64 / opens.max(1) as f64);
    if !errors.is_empty() {
        let mut e = errors.clone();
        e.sort_by(|a, b| a.total_cmp(b));
        let _ = writeln!(s, "- **Reconstruction check:** against Hyperliquid's own account-value points, the median error is {:.1}% of the stake (per agent; worst {:.1}%).", 100.0 * e[e.len() / 2], 100.0 * e[e.len() - 1]);
    }
    let _ = writeln!(s, "\n## Per agent (3x cap, floor at 70%)\n");
    let _ = writeln!(s, "| Model | Competition | Start | End (real) | Max lev. | Mean lev. | Refused at 3x | Floor broke | Investor with Klear | Saved |");
    let _ = writeln!(s, "|---|---|---|---|---|---|---|---|---|---|");
    let mut sorted: Vec<&Report> = reports.iter().collect();
    sorted.sort_by(|a, b| (a.final_usd - a.initial_usd).total_cmp(&(b.final_usd - b.initial_usd)));
    for r in sorted {
        let l = &r.leverage[c];
        let fl = &r.floors[f];
        let _ = writeln!(
            s,
            "| {} | {} | {} | {} | {:.1}x | {:.1}x | {}/{} ({:.0}%) | {} | {} | {} |",
            r.model,
            r.competition,
            usd(r.initial_usd),
            usd(r.final_usd),
            r.max_leverage.min(999.0),
            r.mean_leverage,
            l.refused,
            l.opening_fills,
            100.0 * l.refused_share,
            fl.rescue.as_ref().map_or("no".into(), |x| date(x.time)),
            usd(fl.investor_usd),
            usd(fl.saved_usd),
        );
    }
    let _ = writeln!(s, "\n`summary.json` has every agent under every policy: caps of {CAPS_X:?}x and floors at {FLOORS_PCT:?}% of the start.\n");
    let _ = writeln!(s, "## Method\n");
    let _ = writeln!(s, "- **Data:** `scripts/replay/fetch.py` caches, unmodified, each wallet's ledger (`userNonFundingLedgerUpdates`), every fill");
    let _ = writeln!(s, "  (`userFillsByTime`), every funding payment (`userFunding`) and Hyperliquid's account-value history (`portfolio`)");
    let _ = writeln!(s, "  in `fixtures/replay/raw/`. The wallets come from each model's page on alphaarena.ai (`fixtures/replay/wallets.json`).");
    let _ = writeln!(s, "- **Window:** from the moment the $10,000 stake landed (net inflow first ≥ 90% of it) to the agent's last fill or the first");
    let _ = writeln!(s, "  withdrawal, whichever came first. Earlier test trades are replayed (so positions are right) but not judged.");
    let _ = writeln!(s, "- **Account:** cash moves by transfers, realized PnL and fees from each fill, and funding; positions by fills (Hyperliquid's");
    let _ = writeln!(s, "  `startPosition` is authoritative); equity is cash plus unrealized PnL at each coin's latest traded price.");
    let _ = writeln!(s, "- **Leverage:** at every fill that adds exposure, gross notional of all positions after it against equity before it,");
    let _ = writeln!(s, "  checked with `rules::within_leverage`, the judge's own check. Reductions are never refused.");
    let _ = writeln!(s, "- **Floor:** equity after every event, checked with `rules::below_floor`; the rescue returns the value at the first breach");
    let _ = writeln!(s, "  less `rules::close_cost_usd6` (half a 100 bp band plus 5 bp, Klear's live policy).\n");
    let _ = writeln!(s, "## Limits (read before quoting a number)\n");
    let _ = writeln!(s, "- **Two separate questions, not one simulation.** The refusals are counted on the real path; we do not re-simulate what");
    let _ = writeln!(s, "  the agent would have done instead. The floor rescue follows the real path up to the trigger and stops there.");
    let _ = writeln!(s, "- **Price between fills:** unrealized PnL uses each coin's latest fill price, so equity between that coin's trades is");
    let _ = writeln!(s, "  approximate; the reconstruction check above measures the result against Hyperliquid's own numbers.");
    let _ = writeln!(s, "- **Checked only at events:** a live guardian checks continuously, so a real trigger could only come earlier.");
    let _ = writeln!(s, "- **Execution:** the rescue's close cost assumes the book could absorb the close within half a band; very large or");
    let _ = writeln!(s, "  illiquid positions (some tokenized stocks) could cost more.");
    let _ = writeln!(s, "- **The site's own final values** (alphaarena.ai) are listed in `summary.json` next to ours; they may use a different end time.");
    s
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let raw_dir = args.first().map(String::as_str).unwrap_or("fixtures/replay/raw");
    let out_dir = args.get(1).map(String::as_str).unwrap_or("docs/results/replay");
    let mut reports = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(raw_dir).expect("raw dir").filter_map(Result::ok).map(|e| e.path()).collect();
    entries.sort();
    for path in entries.iter().filter(|p| p.to_string_lossy().ends_with(".json.gz")) {
        let mut text = String::new();
        flate2::read::GzDecoder::new(fs::File::open(path).expect("open")).read_to_string(&mut text).expect("gunzip");
        let raw: Value = serde_json::from_str(&text).expect("json");
        match history::parse(&raw, STAKE_USD) {
            Ok(h) => reports.push(replay(&h, &CAPS_X, &FLOORS_PCT)),
            Err(e) => eprintln!("skip {}: {e}", path.display()),
        }
    }
    fs::create_dir_all(out_dir).expect("out dir");
    let summary = json!({
        "season": "Alpha Arena Season 1.5",
        "policy": { "caps_x": CAPS_X, "floors_pct": FLOORS_PCT, "band_bp": replay::BAND_BP, "fee_bp": replay::FEE_BP, "headline": { "cap_x": CAPS_X[HEADLINE.0], "floor_pct": FLOORS_PCT[HEADLINE.1] } },
        "agents": reports,
    });
    fs::write(Path::new(out_dir).join("summary.json"), serde_json::to_string_pretty(&summary).unwrap()).expect("write");
    fs::write(Path::new(out_dir).join("README.md"), markdown(&reports)).expect("write");
    println!("{} agents -> {out_dir}/summary.json, README.md", reports.len());
}
