//! Command-line front end to keel-core for local tests. State lives in a JSON file; every
//! command prints one JSON object with numbers as decimal strings.
//!
//!   keel-judge init <state> [key=value ...]
//!   keel-judge open|flatten|delever <state> <now> <agent> <perp-log-json> <spot-log-json>
//!   keel-judge settle <state> <now> <perp-log-json> <spot-log-json>
//!   keel-judge confirm-exit <state> <now> <exited-log-json>
//!   keel-judge request-exit <state> <caller>
//!   keel-judge heartbeat|rearm <state> <now> <caller>
//!   keel-judge fund <state> <yocto>
//!   keel-judge propose <state> <now> <caller> <perp-log-json> <spot-log-json> <is-buy> <sz> <limit-px>
//!   keel-judge sweep <state> <now> <perp-log-json> <spot-log-json>
//!   keel-judge value <state> <now> <perp-log-json> <spot-log-json>   liquidation value and exit trigger
//!   keel-judge spot-raw <spot-tx-json> <v> <r> <s>          signed EIP-1559 bytes for broadcast (G6)
//!   keel-judge digest <chain-id> <leg> <nonce> <is-buy> <limit-px> <sz> <reduce-only> <cloid> <deadline>
//!   keel-judge exit-digest <chain-id> <vault> <nonce> <token> <deadline>
//!   keel-judge plan-order <chain-id> <leg> <nonce> <oracle-1e8> <is-buy> <sz> <limit-bp> <sz-decimals> <deadline> <cloid>
//!   keel-judge evm-address <secp256k1:...>
//!   keel-judge sign-args <path> <digest> <domain-id>
//!   keel-judge vrs <signature-response-json>
//!   keel-judge readmpc-request <hyperevm|base> <rpc-log-json> <domain-id>

use keel_core::eip712::{exit_digest, order_digest, Exit, Order};
use keel_core::engine::{Config, OnSilence, Policy, Strategy};
use keel_core::evidence::Log;
use keel_core::{Address, Error};
use serde_json::{json, Value};
use std::fs;

fn stringify(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::String(n.to_string()),
        Value::Array(a) => Value::Array(a.into_iter().map(stringify).collect()),
        // MPC call arguments keep JSON numbers; they are sent to NEAR as-is.
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| if k == "args" { (k, v) } else { (k, stringify(v)) }).collect()),
        other => other,
    }
}

fn fail(code: &str) -> Value {
    json!({ "ok": false, "error": code })
}

fn sim_config(args: &[String]) -> Result<(Config, u128, u64), String> {
    let mut c = Config {
        strategy_id: 1,
        chain_id: 998,
        leg: Address::default(),
        spot_account: Address::default(),
        spot_token: Address::default(),
        probe: Address::default(),
        spot_chain: keel_core::evidence::Chain::Base,
        spot_chain_id: 84532,
        manager: None,
        investor: None,
        investor_account: None,
        policy: Policy {
            perp: 4,
            sz_decimals: 4,
            band_bp: 100,
            max_basis_bp: 200,
            fee_bp: 5,
            max_order_sz: 100_000_000,
            tolerance: 1_000_000,
            max_loss_usd6: 100_000_000,
            settle_delay_l1: 10,
            max_evidence_age_s: 120,
            max_perp_age_s: 0,
            order_ttl_s: 60,
            job_ttl_s: 3_600,
            max_failed_attempts: 3,
            dust: 10_000,
            repair_reward: 1_000_000_000_000_000_000_000_000,
            flatten_reward: 2_000_000_000_000_000_000_000_000,
            spot_reward: 1_000_000_000_000_000_000_000_000,
            max_leverage_bp: 0,
            equity_floor_usd6: 0,
            spot_haircut_bp: 0,
            usdc_dust_usd6: 10_000,
            hedge: true,
            heartbeat_s: 0,
            on_silence: OnSilence::Nothing,
            warn_usd6: 0,
            delever_target_bp: 0,
            delever_reward: 500_000_000_000_000_000_000_000,
        },
    };
    let mut pool: u128 = 10_000_000_000_000_000_000_000_000;
    let mut now = 0;
    for a in args {
        let (k, v) = a.split_once('=').ok_or(format!("bad arg {a}"))?;
        let n = || v.parse::<u64>().map_err(|e| format!("{k}: {e}"));
        let p = &mut c.policy;
        match k {
            "leg" => c.leg = Address::parse(v)?,
            "spot_account" => c.spot_account = Address::parse(v)?,
            "spot_token" => c.spot_token = Address::parse(v)?,
            "probe" => c.probe = Address::parse(v)?,
            "chain_id" => c.chain_id = n()?,
            "strategy_id" => c.strategy_id = n()?,
            "band_bp" => p.band_bp = n()? as u16,
            "max_basis_bp" => p.max_basis_bp = n()? as u16,
            "max_order_sz" => p.max_order_sz = n()?,
            "tolerance" => p.tolerance = n()?,
            "max_loss_usd6" => p.max_loss_usd6 = n()?,
            "settle_delay_l1" => p.settle_delay_l1 = n()?,
            "max_failed_attempts" => p.max_failed_attempts = n()? as u32,
            "max_leverage_bp" => p.max_leverage_bp = n()? as u32,
            "equity_floor_usd6" => p.equity_floor_usd6 = n()?,
            "hedge" => p.hedge = v == "true",
            "spot_haircut_bp" => p.spot_haircut_bp = n()? as u16,
            "usdc_dust_usd6" => p.usdc_dust_usd6 = n()?,
            "heartbeat_s" => p.heartbeat_s = n()?,
            "warn_usd6" => p.warn_usd6 = n()?,
            "delever_target_bp" => p.delever_target_bp = n()? as u32,
            "on_silence" => p.on_silence = if v == "exit" { OnSilence::Exit } else { OnSilence::Nothing },
            "spot_chain_id" => c.spot_chain_id = n()?,
            "manager" => c.manager = Some(v.to_string()),
            "investor" => c.investor = Some(Address::parse(v)?),
            "investor_account" => c.investor_account = Some(v.to_string()),
            "pool" => pool = v.parse().map_err(|e| format!("pool: {e}"))?,
            "now" => now = n()?,
            _ => return Err(format!("unknown key {k}")),
        }
    }
    Ok((c, pool, now))
}

fn load(path: &str) -> Result<Strategy, String> {
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn save(path: &str, s: &Strategy) -> Result<(), String> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())
}

fn log(arg: &str) -> Result<Log, String> {
    serde_json::from_str(arg).map_err(|e| format!("log json: {e}"))
}

fn rpc_log(arg: &str) -> Result<keel_core::readmpc::EvmLog, String> {
    keel_core::readmpc::EvmLog::from_rpc(&serde_json::from_str(arg).map_err(|e| e.to_string())?)
}

fn summary(s: &Strategy, mut out: Value) -> Value {
    out["ok"] = json!(true);
    out["mode"] = serde_json::to_value(s.mode).unwrap();
    out["pool"] = json!(s.pool.to_string());
    out["payouts"] = json!(s.payouts.len());
    out["nonce"] = json!(s.nonce);
    out
}

fn run(args: &[String]) -> Result<Value, String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let a = |i: usize| args.get(i).cloned().ok_or(format!("missing argument {i}"));
    let num = |i: usize| -> Result<u64, String> { a(i)?.parse().map_err(|e| format!("arg {i}: {e}")) };
    let apply = |path: &str, r: Result<keel_core::engine::Outcome, Error>, s: Strategy| -> Result<Value, String> {
        match r {
            Ok(o) => {
                save(path, &s)?;
                Ok(summary(&s, serde_json::to_value(o).unwrap()))
            }
            Err(e) => Ok(fail(&e.code())),
        }
    };
    match cmd {
        "init" => {
            let (c, pool, now) = sim_config(&args[2..])?;
            match Strategy::new(c, pool, now) {
                Ok(s) => {
                    save(&a(1)?, &s)?;
                    Ok(summary(&s, json!({})))
                }
                Err(e) => Ok(fail(&e.code())),
            }
        }
        "open" | "flatten" | "delever" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let (perp, spot) = (log(&a(4)?)?, log(&a(5)?)?);
            let r = match cmd {
                "open" => s.open_repair(num(2)?, &a(3)?, &perp, &spot),
                "flatten" => s.open_flatten(num(2)?, &a(3)?, &perp, &spot),
                _ => s.open_deleverage(num(2)?, &a(3)?, &perp, &spot),
            };
            apply(&path, r, s)
        }
        "settle" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let r = s.settle(num(2)?, &log(&a(3)?)?, &log(&a(4)?)?);
            apply(&path, r, s)
        }
        "propose" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let r = s.propose(num(2)?, &a(3)?, &log(&a(4)?)?, &log(&a(5)?)?, a(6)? == "true", num(7)?, num(8)?);
            apply(&path, r, s)
        }
        "sweep" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let r = s.sweep(num(2)?, &log(&a(3)?)?, &log(&a(4)?)?);
            apply(&path, r, s)
        }
        "spot-raw" => {
            let tx: keel_core::spot::SpotTx = serde_json::from_str(&a(1)?).map_err(|e| e.to_string())?;
            let v = num(2)?;
            let r = keel_core::B32::parse(&a(3)?)?;
            let sg = keel_core::B32::parse(&a(4)?)?;
            Ok(json!({ "ok": true, "raw": format!("0x{}", hex::encode(tx.raw_signed((v - 27) as u8, &r.0, &sg.0))) }))
        }
        "confirm-exit" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let r = s.confirm_exit(num(2)?, &log(&a(3)?)?);
            apply(&path, r, s)
        }
        "request-exit" | "heartbeat" | "rearm" | "fund" => {
            let path = a(1)?;
            let mut s = load(&path)?;
            let r = match cmd {
                "request-exit" => s.request_exit(&a(2)?),
                "heartbeat" => s.heartbeat(num(2)?, &a(3)?),
                "rearm" => s.rearm(num(2)?, &a(3)?),
                _ => s.fund(a(2)?.parse().map_err(|e| format!("yocto: {e}"))?),
            };
            match r {
                Ok(()) => {
                    save(&path, &s)?;
                    Ok(summary(&s, json!({})))
                }
                Err(e) => Ok(fail(&e.code())),
            }
        }
        "value" => {
            let s = load(&a(1)?)?;
            match s.valuation_of(num(2)?, &log(&a(3)?)?, &log(&a(4)?)?) {
                Ok((v, trigger)) => Ok(json!({ "ok": true, "valuation": v, "trigger": trigger })),
                Err(e) => Ok(fail(&e.code())),
            }
        }
        "exit-digest" => {
            let x = Exit { nonce: num(3)?, token: Address::parse(&a(4)?)?, deadline: num(5)? };
            let d = exit_digest(num(1)?, &Address::parse(&a(2)?)?, &x);
            Ok(json!({ "ok": true, "digest": format!("0x{}", hex::encode(d)) }))
        }
        "digest" => {
            let o = Order {
                nonce: num(3)?,
                is_buy: a(4)? == "true",
                limit_px: num(5)?,
                sz: num(6)?,
                reduce_only: a(7)? == "true",
                cloid: a(8)?.parse().map_err(|e| format!("cloid: {e}"))?,
                deadline: num(9)?,
            };
            let d = order_digest(num(1)?, &Address::parse(&a(2)?)?, &o);
            Ok(json!({ "ok": true, "digest": format!("0x{}", hex::encode(d)) }))
        }
        "plan-order" => {
            let is_buy = a(5)? == "true";
            let (oracle, offset, szd) = (num(4)?, num(7)?, num(8)? as u8);
            let edge = if is_buy { oracle * (10_000 + offset) / 10_000 } else { oracle * (10_000 - offset) / 10_000 };
            let limit_px = keel_core::px::round_px(edge, szd, !is_buy).ok_or("no valid price")?;
            let o = Order {
                nonce: num(3)?,
                is_buy,
                limit_px,
                sz: num(6)?,
                reduce_only: false,
                cloid: a(10)?.parse().map_err(|e| format!("cloid: {e}"))?,
                deadline: num(9)?,
            };
            let d = order_digest(num(1)?, &Address::parse(&a(2)?)?, &o);
            Ok(json!({ "ok": true, "order": o, "digest": format!("0x{}", hex::encode(d)) }))
        }
        "evm-address" => {
            let a = keel_core::mpc::evm_address(&a(1)?)?;
            Ok(json!({ "ok": true, "address": format!("0x{}", hex::encode(a)) }))
        }
        "sign-args" => {
            let d = keel_core::B32::parse(&a(2)?)?;
            Ok(json!({ "ok": true, "args": keel_core::mpc::sign_args(&a(1)?, &d.0, num(3)?) }))
        }
        "vrs" => {
            let v: Value = serde_json::from_str(&a(1)?).map_err(|e| e.to_string())?;
            let (v, r, s) = keel_core::mpc::vrs(&v)?;
            Ok(json!({ "ok": true, "v": v, "r": format!("0x{}", hex::encode(r)), "s": format!("0x{}", hex::encode(s)) }))
        }
        "readmpc-request" => {
            let chain = match a(1)?.as_str() {
                "hyperevm" => keel_core::evidence::Chain::HyperEvm,
                "base" => keel_core::evidence::Chain::Base,
                c => return Err(format!("chain {c}")),
            };
            let log = rpc_log(&a(2)?)?;
            let (h, args) = keel_core::readmpc::log_request(chain, &log, num(3)?);
            let evidence = log.to_evidence(chain)?;
            Ok(json!({ "ok": true, "expected_payload_hash": hex::encode(h), "args": args, "evidence": evidence }))
        }
        _ => Err(format!("unknown command {cmd:?}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = run(&args).unwrap_or_else(|e| fail(&format!("usage:{e}")));
    println!("{}", stringify(out));
}
