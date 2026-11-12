//! Strategy state machine: a manager's mandate, hedge repair jobs, the manager-proof rescue (exit),
//! settlement and rewards.
//!
//! Sizes are in CoreWriter units (1e8 = one unit of the base asset). The hedge is a short:
//! target `szi` = -spot. `delta` = spot + perp; positive means under-hedged.
//!
//! The mandate: a named manager (an AI agent or a person) may only *propose* orders; each is signed
//! only within the size, price band and leverage the investor set, and never while the strategy's
//! liquidation value is below the investor's floor. Once an exit is triggered (the floor, the
//! investor's own request, a silent manager if the investor chose that, or exhausted repair) anyone
//! may run the rescue, which moves both legs to the investor's fixed addresses and pays each leg's
//! reward only on evidence that it arrived.
//!
//! Every public method is transactional: a refusal returns an error and changes nothing.
//!
//! Modules: [`orders`] plans and checks bounded IOC orders; [`valuation`] prices both legs;
//! [`mandate`] holds the manager's and the investor's powers; [`repair`] the hedge repair job;
//! [`deleverage`] the early-warning risk cut; [`rescue`] the exit.

mod deleverage;
mod mandate;
mod orders;
mod repair;
mod rescue;
mod valuation;

pub use rescue::{Delivery, ExitState, Leg, LegStatus, Owed, Rescue, SweepState, Trigger};
pub use valuation::Valuation;

use crate::eip712::{Exit, Order, Sweep};
use crate::evidence::{decode_balance, decode_snapshot, Chain, Log, PerpSnapshot, SpotBalance};
use crate::px::lot;
use crate::{Address, Error, B32};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Policy {
    pub perp: u32,
    pub sz_decimals: u8,
    /// KeelLeg rejects any limit outside the mark +- band at execution. Planned limits sit at half
    /// the band, so normal price drift between planning and relaying does not void the order.
    pub band_bp: u16,
    /// No order is planned while |mark - oracle| exceeds this share of the oracle (KeelLeg enforces
    /// its own cap at execution).
    pub max_basis_bp: u16,
    pub fee_bp: u16,
    pub max_order_sz: u64,
    /// |delta| above this is a broken hedge; at or below it a repair succeeded.
    pub tolerance: u64,
    /// Worst-case cost of one job (slippage to the band edge plus fees), USD x 1e6.
    pub max_loss_usd6: u64,
    /// HyperCore blocks after the last queued action before a snapshot counts as settled.
    pub settle_delay_l1: u64,
    pub max_evidence_age_s: u64,
    /// Perp snapshots are planned and valued on, so they must be younger than this (0 =
    /// `max_evidence_age_s`). Spot evidence keeps the longer limit: Base takes ~20 min to finalize.
    #[serde(default)]
    pub max_perp_age_s: u64,
    /// Lifetime of every signed action (orders, sweeps, vault exits).
    pub order_ttl_s: u64,
    pub job_ttl_s: u64,
    /// Executed attempts (orders or sweeps) that leave the job's goal unmet before it is exhausted.
    pub max_failed_attempts: u32,
    /// A position or spot balance at or below this size counts as empty.
    pub dust: u64,
    #[serde(with = "crate::dec")]
    pub repair_reward: u128,
    /// Rescue reward for the perp leg: closed, swept, and the USDC seen at the payout.
    #[serde(with = "crate::dec")]
    pub flatten_reward: u128,
    /// Rescue reward for the spot leg: the vault's exit receipt attested.
    #[serde(default, with = "crate::dec")]
    pub spot_reward: u128,
    /// The manager's ceiling: |perp notional| / liquidation value after the order, in bp.
    #[serde(default)]
    pub max_leverage_bp: u32,
    /// Liquidation value below this triggers the exit, USD x 1e6. 0 = no floor.
    #[serde(default)]
    pub equity_floor_usd6: u64,
    /// Haircut on the spot leg's value, bp: the gap a Base sale could realise against the perp's
    /// oracle and mark (the two venues price the same asset, not the same market).
    #[serde(default)]
    pub spot_haircut_bp: u16,
    /// USDC (USD x 1e6) at or below which the leg counts as swept, and the shortfall allowed between
    /// what a sweep owed and what the payout received (HyperCore fees and rounding).
    #[serde(default)]
    pub usdc_dust_usd6: u64,
    /// Whether a broken hedge may be repaired (off for a directional manager's mandate).
    #[serde(default = "yes")]
    pub hedge: bool,
    /// The manager must call `heartbeat` (or propose) at least this often; 0 = no heartbeat.
    #[serde(default)]
    pub heartbeat_s: u64,
    /// What the investor chose to allow when the manager falls silent. Silence alone is not
    /// evidence of danger, so the default is nothing.
    #[serde(default)]
    pub on_silence: OnSilence,
    /// Deleveraging: anyone may cut the position to `delever_target_bp` of the liquidation value
    /// (reduce-only) when the value falls under this early-warning level, USD x 1e6. 0 = no warning level.
    #[serde(default)]
    pub warn_usd6: u64,
    /// The leverage a deleverage cuts to, in bp of the liquidation value. 0 = no deleveraging. A
    /// position that has drifted above `max_leverage_bp` (prices moved, no new order) is also cut here.
    #[serde(default)]
    pub delever_target_bp: u32,
    #[serde(default, with = "crate::dec")]
    pub delever_reward: u128,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnSilence {
    /// Nothing happens; the mandate's other rules keep applying.
    #[default]
    Nothing,
    /// Anyone may run the rescue.
    Exit,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub strategy_id: u64,
    /// EIP-155 chain id of HyperEVM (KeelLeg's signing domain).
    pub chain_id: u64,
    pub leg: Address,
    /// Where the spot leg is held. With an investor configured this is a KeelVault, which also
    /// emits the `Balance` evidence (so `probe` must equal it).
    pub spot_account: Address,
    pub spot_token: Address,
    pub probe: Address,
    /// Chain of the spot leg's evidence.
    #[serde(default = "default_spot_chain")]
    pub spot_chain: Chain,
    /// EIP-155 chain id of the spot chain (KeelVault's signing domain).
    #[serde(default)]
    pub spot_chain_id: u64,
    /// NEAR account allowed to propose orders.
    #[serde(default)]
    pub manager: Option<String>,
    /// The investor's EVM address: KeelLeg's and KeelVault's immutable payout. Required for exits.
    #[serde(default)]
    pub investor: Option<Address>,
    /// NEAR account allowed to request an exit at any time (the investor).
    #[serde(default)]
    pub investor_account: Option<String>,
    pub policy: Policy,
}

fn default_spot_chain() -> Chain {
    Chain::Base
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    Active,
    Repairing,
    RepairExhausted,
    /// A deleverage job is cutting the position back to the investor's target.
    Deleveraging,
    /// An exit was triggered; it stays triggered until both legs are done.
    Flattening,
    /// Both legs are done. Only residual sweeps (no reward) remain possible.
    Flattened,
    Frozen,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Repair,
    Flatten,
    Deleverage,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attempt {
    pub order: Order,
    pub digest: B32,
    pub signed_at: u64,
    pub pre_szi_1e8: i128,
    pub pre_entry_ntl: u64,
    pub worst_loss_usd6: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Job {
    pub id: u64,
    pub kind: JobKind,
    pub agent: String,
    pub opened_at: u64,
    pub expires_at: u64,
    #[serde(with = "crate::dec")]
    pub pre_spot_wei: u128,
    pub signed: u32,
    pub failed: u32,
    pub loss_used_usd6: u64,
    /// The perp order in flight.
    pub attempt: Option<Attempt>,
    /// Reward set aside from the pool for this job; whatever is not paid returns to it.
    #[serde(default, with = "crate::dec")]
    pub reserved: u128,
    /// A deleverage job's goal: the absolute position size (1e8 units) it cuts down to.
    #[serde(default)]
    pub target_1e8: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payout {
    pub job_id: u64,
    pub agent: String,
    #[serde(with = "crate::dec")]
    pub amount: u128,
    /// What was paid for: "repair", "perp" or "spot".
    #[serde(default)]
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Strategy {
    pub config: Config,
    pub mode: Mode,
    /// KeelLeg's nonce as last proven by evidence.
    pub nonce: u64,
    /// Unreserved reward funds.
    #[serde(with = "crate::dec")]
    pub pool: u128,
    pub next_job_id: u64,
    pub job: Option<Job>,
    /// The investor asked for an exit.
    pub exit_requested: bool,
    pub frozen_reason: Option<String>,
    pub used: BTreeSet<(Chain, B32, u64)>,
    pub payouts: Vec<Payout>,
    /// The manager's order in flight.
    pub pending: Option<Attempt>,
    /// The manager's last sign of life (a heartbeat or a signed proposal), NEAR block seconds.
    pub last_heartbeat: u64,
    pub rescue: Rescue,
    /// How many times the investor has re-armed the strategy after a rescue.
    #[serde(default)]
    pub cycle: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OrderPlan {
    pub order: Order,
    pub digest: B32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SweepPlan {
    pub sweep: Sweep,
    pub digest: B32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ExitPlan {
    pub exit: Exit,
    pub digest: B32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum Outcome {
    /// Ask the MPC to sign `digest`; anyone may then relay the order to KeelLeg.
    Sign { job_id: u64, order: Order, digest: B32 },
    /// One step of the exit: what to sign next (any of a perp order, a KeelLeg sweep, a KeelVault
    /// exit), what was verified delivered, who was paid, and each leg's status.
    Rescue {
        job_id: u64,
        trigger: Trigger,
        order: Option<OrderPlan>,
        sweep: Option<SweepPlan>,
        exit: Option<ExitPlan>,
        delivered: Vec<Delivery>,
        paid: Vec<Payout>,
        perp: LegStatus,
        spot: LegStatus,
        /// Set when the job ended here without finishing (expired, exhausted); the exit stays open
        /// for a new job.
        ended: Option<String>,
        done: bool,
    },
    /// After the exit: anything left on (or arriving later at) either leg goes to the investor.
    Residual { sweep: Option<SweepPlan>, exit: Option<ExitPlan>, delivered: Vec<Delivery> },
    Repaired { job_id: u64, payout: Payout },
    /// The job ended unpaid; the strategy is open for a new job.
    Voided { job_id: u64, reason: String },
    /// Repair failed within its bounds; an exit is now allowed.
    Exhausted { job_id: u64, reason: String },
    /// The leg did something no signed order allows. Nothing more is signed.
    Frozen { reason: String },
}

pub(crate) struct Evidence {
    pub perp: PerpSnapshot,
    pub spot: SpotBalance,
    pub ids: [(Chain, B32, u64); 2],
}

impl Strategy {
    pub fn new(config: Config, pool: u128, now: u64) -> Result<Self, Error> {
        let p = &config.policy;
        if p.sz_decimals > 6 || p.band_bp == 0 || p.band_bp >= 10_000 || p.spot_haircut_bp >= 10_000 {
            return Err(Error::BadPolicy("band-or-decimals"));
        }
        if p.tolerance < lot(p.sz_decimals) || p.dust < lot(p.sz_decimals) {
            return Err(Error::BadPolicy("tolerance-below-lot"));
        }
        if p.max_order_sz < lot(p.sz_decimals) || p.max_failed_attempts == 0 || p.settle_delay_l1 == 0 {
            return Err(Error::BadPolicy("limits"));
        }
        if config.investor.is_some() && config.spot_account != config.probe {
            return Err(Error::BadPolicy("spot-leg-must-be-a-vault"));
        }
        if p.on_silence == OnSilence::Exit && p.heartbeat_s == 0 {
            return Err(Error::BadPolicy("silence-needs-a-heartbeat"));
        }
        if p.warn_usd6 > 0 && (p.delever_target_bp == 0 || p.warn_usd6 <= p.equity_floor_usd6) {
            return Err(Error::BadPolicy("warning-needs-a-target-above-the-floor"));
        }
        Ok(Self {
            config,
            mode: Mode::Active,
            nonce: 0,
            pool,
            next_job_id: 1,
            job: None,
            exit_requested: false,
            frozen_reason: None,
            used: BTreeSet::new(),
            payouts: Vec::new(),
            pending: None,
            last_heartbeat: now,
            rescue: Rescue::default(),
            cycle: 0,
        })
    }

    pub(crate) fn policy(&self) -> &Policy {
        &self.config.policy
    }

    /// Run `f` on a copy and keep the result only if it succeeds: a refusal changes nothing.
    pub(crate) fn transact<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, Error>) -> Result<T, Error> {
        let mut next = self.clone();
        let out = f(&mut next)?;
        *self = next;
        Ok(out)
    }

    /// Anyone: settle the open job on attested evidence.
    pub fn settle(&mut self, now: u64, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        self.transact(|s| {
            if s.mode == Mode::Frozen {
                return Err(Error::Frozen);
            }
            match s.job.as_ref().ok_or(Error::NoOpenJob)?.kind {
                JobKind::Repair => s.settle_repair(now, perp, spot),
                JobKind::Flatten => s.settle_rescue(now, perp, spot),
                JobKind::Deleverage => s.settle_deleverage(now, perp, spot),
            }
        })
    }

    /// Anyone: add to the reward pool.
    pub fn fund(&mut self, amount: u128) -> Result<(), Error> {
        self.transact(|s| {
            s.pool = s.pool.checked_add(amount).ok_or(Error::BadPolicy("pool-overflow"))?;
            Ok(())
        })
    }

    // ---------- evidence ----------

    /// `reuse_spot`: a balance reading stays valid until the judge itself moves the spot leg, so it
    /// may be cited again (it still has to be fresh).
    pub(crate) fn evidence(&self, now: u64, perp: &Log, spot: &Log, reuse_spot: bool) -> Result<Evidence, Error> {
        let c = &self.config;
        let ids = [perp.id(), spot.id()];
        if self.used.contains(&ids[0]) || (!reuse_spot && self.used.contains(&ids[1])) || ids[0] == ids[1] {
            return Err(Error::EvidenceReused);
        }
        if perp.emitter != c.leg || spot.emitter != c.probe {
            return Err(Error::BadEvidence("emitter"));
        }
        let s = decode_snapshot(perp)?;
        let b = decode_balance(spot, c.spot_chain)?;
        if s.account != c.leg || s.perp != c.policy.perp {
            return Err(Error::BadEvidence("snapshot-account"));
        }
        if b.account != c.spot_account || b.token != c.spot_token {
            return Err(Error::BadEvidence("balance-account"));
        }
        let fresh = |ts: u64, age: u64| ts + age >= now && ts <= now + 60;
        let perp_age = match c.policy.max_perp_age_s {
            0 => c.policy.max_evidence_age_s,
            a => a,
        };
        if !fresh(s.timestamp, perp_age) || !fresh(b.timestamp, c.policy.max_evidence_age_s) || s.last_nonce < self.nonce {
            return Err(Error::StaleEvidence);
        }
        Ok(Evidence { perp: s, spot: b, ids })
    }

    pub(crate) fn settled(&self, s: &PerpSnapshot) -> bool {
        s.last_nonce == 0 || s.l1_block >= s.last_queued_l1 + self.policy().settle_delay_l1
    }

    pub(crate) fn spot_1e8(&self, wei: u128) -> i128 {
        (wei / 10u128.pow(10)) as i128
    }

    pub(crate) fn perp_1e8(&self, szi: i64) -> i128 {
        szi as i128 * lot(self.policy().sz_decimals) as i128
    }

    /// Whether `s` proves that the signed KeelLeg action with this nonce can no longer change
    /// anything, and if so whether it executed. A never-relayed action is dead once the snapshot's
    /// time passes its deadline.
    pub(crate) fn resolve(&self, s: &PerpSnapshot, nonce: u64, deadline: u64) -> Result<bool, Error> {
        if s.last_nonce == nonce {
            return if s.timestamp > deadline { Ok(false) } else { Err(Error::AttemptNotResolved) };
        }
        if s.last_nonce == nonce + 1 {
            return if self.settled(s) { Ok(true) } else { Err(Error::SnapshotNotSettled) };
        }
        Err(Error::UnknownSignedAction)
    }

    /// Before a new job: everything signed earlier must be over on this evidence. Returns the
    /// reserve of the job this one replaces. Changes nothing.
    pub(crate) fn clear_to_open(&self, now: u64, kind: JobKind, ev: &Evidence) -> Result<u128, Error> {
        let mut in_flight = false;
        if let Some(p) = &self.pending {
            self.resolve(&ev.perp, p.order.nonce, p.order.deadline)?;
            in_flight = true;
        }
        let mut released = 0;
        if let Some(job) = &self.job {
            // An exit may pre-empt a repair; otherwise only an expired job can be replaced.
            let preempt = kind == JobKind::Flatten && job.kind != JobKind::Flatten;
            if now < job.expires_at && !preempt {
                return Err(Error::JobActive);
            }
            if let Some(a) = &job.attempt {
                self.resolve(&ev.perp, a.order.nonce, a.order.deadline)?;
                in_flight = true;
            }
            released = job.reserved;
        }
        if let Some(w) = &self.rescue.sweep {
            self.resolve(&ev.perp, w.nonce, w.deadline)?;
            in_flight = true;
        }
        if !in_flight {
            if ev.perp.last_nonce != self.nonce {
                return Err(Error::UnknownSignedAction);
            }
            if !self.settled(&ev.perp) {
                return Err(Error::SnapshotNotSettled);
            }
        }
        Ok(released)
    }

    // ---------- endings ----------

    /// Pay `amount` to the job's agent: from the job's reserve, else from the pool, else nothing.
    pub(crate) fn pay(&mut self, job: &mut Job, amount: u128, reason: &str) -> Option<Payout> {
        if amount == 0 {
            return None;
        }
        if job.reserved >= amount {
            job.reserved -= amount;
        } else if self.pool >= amount {
            self.pool -= amount;
        } else {
            return None;
        }
        let payout = Payout { job_id: job.id, agent: job.agent.clone(), amount, reason: reason.into() };
        self.payouts.push(payout.clone());
        Some(payout)
    }

    /// End the open job, returning its unpaid reserve to the pool.
    pub(crate) fn release(&mut self) {
        if let Some(j) = self.job.take() {
            self.pool += j.reserved;
        }
    }

    pub(crate) fn void(&mut self, job_id: u64, reason: &str) -> Outcome {
        let kind = self.job.as_ref().map(|j| j.kind);
        self.release();
        self.mode = if kind == Some(JobKind::Flatten) { Mode::Flattening } else { Mode::Active };
        Outcome::Voided { job_id, reason: reason.into() }
    }

    pub(crate) fn freeze(&mut self, reason: &str) -> Outcome {
        self.release();
        self.mode = Mode::Frozen;
        self.frozen_reason = Some(reason.into());
        Outcome::Frozen { reason: reason.into() }
    }
}
