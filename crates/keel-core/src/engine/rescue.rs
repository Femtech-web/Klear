//! The rescue: once an exit is triggered, anyone (a "guardian", human or AI) moves both legs to the
//! investor's fixed addresses, and is paid per leg, only on evidence the investor received it.
//!
//! Perp leg (Hyperliquid): bounded reduce-only closes until the position is flat, then a KeelLeg
//! sweep of all its USDC to the immutable payout. Delivered when a settled snapshot shows the leg
//! empty *and* the payout's spot USDC up by what the leg held when the first sweep was signed.
//! A leg that empties without that arrival (liquidation, bankruptcy) is `Unverified`: no reward.
//!
//! Spot leg (Base): a KeelVault exit (its whole balance to the immutable payout). Delivered when
//! the vault's `Exited` receipt for the signed nonce is attested. A failed transfer reverts and
//! spends nothing, so the same signature (or a fresh one, same nonce) can be retried.
//!
//! The legs proceed independently: a stuck spot asset never holds the USDC back, and each leg's
//! reward is paid once. A job that expires leaves the exit open for another guardian, who picks up
//! exactly where it stopped.

use super::{Evidence, ExitPlan, Job, JobKind, Mode, OrderPlan, Outcome, Payout, Strategy, SweepPlan};
use crate::eip712::{exit_digest, sweep_digest, Exit, Sweep};
use crate::evidence::{decode_exited, Chain, Log};
use crate::{Bytes, Error, B32};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Trigger {
    Investor,
    Floor,
    ManagerSilent,
    RepairExhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Leg {
    Perp,
    Spot,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LegStatus {
    /// Assets still on the leg, or a transfer in flight.
    #[default]
    Open,
    /// Verified at the investor's address.
    Delivered,
    /// Nothing was there to deliver.
    Empty,
    /// The leg emptied but the arrival could not be verified: no reward.
    Unverified,
}

impl LegStatus {
    pub fn done(self) -> bool {
        self != LegStatus::Open
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SweepState {
    pub nonce: u64,
    pub deadline: u64,
    pub usd_ntl: u64,
    pub usdc_wei: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExitState {
    pub nonce: u64,
    pub deadline: u64,
}

/// What the perp leg owes the payout: its USDC when the first sweep was signed, and the payout's
/// own balance then (both HyperCore wei, 1e8 per dollar).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owed {
    pub usdc_wei: u64,
    pub payout_before: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Delivery {
    pub leg: Leg,
    /// USDC wei (perp leg) or token wei (spot leg) that reached the investor.
    #[serde(with = "crate::dec")]
    pub amount: u128,
    /// The attested log that proves it.
    pub evidence: (Chain, B32, u64),
    /// When the judge verified it (NEAR block seconds), and in which of the strategy's cycles.
    #[serde(default)]
    pub at: u64,
    #[serde(default)]
    pub cycle: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rescue {
    pub trigger: Option<Trigger>,
    /// The guardian answerable for the rescue: the latest exit job's agent.
    pub agent: Option<String>,
    pub perp: LegStatus,
    pub spot: LegStatus,
    pub owed: Option<Owed>,
    /// The KeelLeg sweep in flight.
    pub sweep: Option<SweepState>,
    pub failed_sweeps: u32,
    /// The KeelVault exit signed and not yet proven.
    pub exit: Option<ExitState>,
    pub vault_nonce: u64,
    pub deliveries: Vec<Delivery>,
}

/// What one step decided to sign and pay.
#[derive(Default)]
struct Step {
    order: Option<OrderPlan>,
    sweep: Option<SweepPlan>,
    exit: Option<ExitPlan>,
    delivered: Vec<Delivery>,
    paid: Vec<Payout>,
    ended: Option<String>,
}

impl Strategy {
    /// Any agent except the manager, once an exit is triggered: open (or take over) the rescue.
    pub fn open_flatten(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        self.transact(|s| s.open_rescue(now, agent, perp, spot))
    }

    fn open_rescue(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        match self.mode {
            Mode::Frozen => return Err(Error::Frozen),
            Mode::Flattened => return Err(Error::Mandate("already-rescued")),
            _ => {}
        }
        if self.config.investor.is_none() {
            return Err(Error::Mandate("no-investor-address"));
        }
        if self.config.manager.as_deref() == Some(agent) {
            return Err(Error::Mandate("manager-cannot-guard"));
        }
        let ev = self.evidence(now, perp, spot, false)?;
        let trigger = self.exit_trigger(now, &self.valuation(&ev)?).ok_or(Error::FlattenNotTriggered)?;
        let released = self.clear_to_open(now, JobKind::Flatten, &ev)?;

        let p = self.policy();
        let perp_work = !self.rescue.perp.done() && (self.perp_1e8(ev.perp.szi).unsigned_abs() > p.dust as u128 || !self.leg_empty(&ev));
        let spot_work = !self.rescue.spot.done() && (self.spot_1e8(ev.spot.balance) > p.dust as i128 || self.rescue.exit.is_some());
        // With nothing left on either leg (say, after a liquidation) the step below closes the exit
        // out with no reward.
        let reserve = if perp_work { p.flatten_reward } else { 0 } + if spot_work { p.spot_reward } else { 0 };
        if self.pool + released < reserve {
            return Err(Error::RewardPoolEmpty);
        }

        // An order still in flight (the manager's, or the replaced job's) is carried into this job, so
        // the step below checks what it did.
        let carried = self.job.as_mut().and_then(|j| j.attempt.take()).or(self.pending.take());
        let job = Job {
            id: self.next_job_id,
            kind: JobKind::Flatten,
            agent: agent.to_string(),
            opened_at: now,
            expires_at: now + self.policy().job_ttl_s,
            pre_spot_wei: ev.spot.balance,
            signed: 0,
            failed: 0,
            loss_used_usd6: 0,
            attempt: carried,
            reserved: reserve,
            target_1e8: 0,
        };
        self.release();
        self.pool -= reserve;
        self.next_job_id += 1;
        self.mode = Mode::Flattening;
        self.exit_requested = false;
        self.rescue.trigger.get_or_insert(trigger);
        self.used.extend(ev.ids);
        self.step(now, job, &ev)
    }

    /// The open exit job, on fresh evidence (the spot reading may be one already cited).
    pub(crate) fn settle_rescue(&mut self, now: u64, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        let job = self.job.clone().ok_or(Error::NoOpenJob)?;
        let ev = self.evidence(now, perp, spot, true)?;
        if job.attempt.is_none() && self.rescue.sweep.is_none() && ev.perp.last_nonce != self.nonce {
            return Err(Error::UnknownSignedAction);
        }
        self.used.extend(ev.ids);
        self.step(now, job, &ev)
    }

    /// One step: resolve what is in flight on KeelLeg, record and pay what was delivered, then sign
    /// what comes next on each leg.
    fn step(&mut self, now: u64, mut job: Job, ev: &Evidence) -> Result<Outcome, Error> {
        let p = self.policy().clone();
        let post = self.perp_1e8(ev.perp.szi);
        let mut st = Step::default();

        // At most one KeelLeg action is ever in flight: a close order or a sweep.
        if let Some(a) = job.attempt.take() {
            let executed = self.resolve(&ev.perp, a.order.nonce, a.order.deadline)?;
            if let Some(out) = self.check_execution(&job, &a, &ev.perp, post, executed) {
                return Ok(out);
            }
            // Only this job's own closes count against it (a carried order was signed before it).
            if executed && post.unsigned_abs() > p.dust as u128 && a.signed_at >= job.opened_at {
                job.failed += 1;
            } else if !executed {
                job.loss_used_usd6 = job.loss_used_usd6.saturating_sub(a.worst_loss_usd6);
            }
        }
        if let Some(w) = self.rescue.sweep.clone() {
            let executed = self.resolve(&ev.perp, w.nonce, w.deadline)?;
            self.rescue.sweep = None;
            if executed && !self.leg_empty(ev) {
                self.rescue.failed_sweeps += 1;
            }
        }
        self.nonce = ev.perp.last_nonce;

        // The perp leg is done once flat and swept; delivered only if the payout shows the USDC.
        if !self.rescue.perp.done() && post.unsigned_abs() <= p.dust as u128 && self.leg_empty(ev) {
            self.rescue.perp = match &self.rescue.owed {
                None => LegStatus::Empty,
                Some(o) if ev.perp.payout_usdc as u128 + p.usdc_dust_usd6 as u128 * 100 >= o.payout_before as u128 + o.usdc_wei as u128 => {
                    let d = Delivery { leg: Leg::Perp, amount: o.usdc_wei as u128, evidence: ev.ids[0], at: now, cycle: self.cycle };
                    self.rescue.deliveries.push(d.clone());
                    st.delivered.push(d);
                    st.paid.extend(self.pay(&mut job, p.flatten_reward, "perp"));
                    LegStatus::Delivered
                }
                Some(_) => LegStatus::Unverified,
            };
        }
        // A vault that is empty without an exit ever signed had nothing to deliver.
        if !self.rescue.spot.done() && self.rescue.exit.is_none() && self.spot_1e8(ev.spot.balance) <= p.dust as i128 {
            self.rescue.spot = LegStatus::Empty;
        }

        if self.rescue.perp.done() && self.rescue.spot.done() {
            return Ok(self.finish(job, st));
        }
        if now >= job.expires_at {
            st.ended = Some("job-expired".into());
            return Ok(self.end_job(job, st));
        }

        // Next on the perp leg: a close order, else a sweep of whatever USDC is still on the leg.
        if !self.rescue.perp.done() {
            if post.unsigned_abs() > p.dust as u128 {
                if job.failed >= p.max_failed_attempts {
                    st.ended = Some("close-attempts".into());
                    return Ok(self.end_job(job, st));
                }
                match self.plan(now, &job, &ev.perp, ev.spot.balance) {
                    Ok(Some(a)) => {
                        job.signed += 1;
                        job.loss_used_usd6 += a.worst_loss_usd6;
                        st.order = Some(OrderPlan { order: a.order.clone(), digest: a.digest });
                        job.attempt = Some(a);
                    }
                    Ok(None) => {}
                    Err(Error::LossBudgetExhausted) => {
                        st.ended = Some("loss-budget".into());
                        return Ok(self.end_job(job, st));
                    }
                    // Wait for the market to come back; the exit stays triggered.
                    Err(Error::MarketDislocated) => {
                        st.ended = Some("market-dislocated".into());
                        return Ok(self.end_job(job, st));
                    }
                    Err(e) => return Ok(self.freeze(&e.code())),
                }
            } else if !self.leg_empty(ev) {
                if self.rescue.failed_sweeps >= p.max_failed_attempts {
                    st.ended = Some("sweep-attempts".into());
                    return Ok(self.end_job(job, st));
                }
                st.sweep = Some(self.sign_sweep(now, ev));
            }
        }
        // Next on the spot leg: a vault exit, unless one is still valid. A new signature (same
        // nonce, so at most one ever executes) only once a reading taken after the old one's
        // deadline still shows the balance.
        if !self.rescue.spot.done() && self.spot_1e8(ev.spot.balance) > p.dust as i128 {
            let stale = self.rescue.exit.as_ref().is_none_or(|x| ev.spot.timestamp > x.deadline);
            if stale {
                st.exit = Some(self.sign_exit(now));
            }
        }
        self.job = Some(job.clone());
        Ok(self.outcome(&job, st, false))
    }

    /// Anyone: the vault's `Exited` receipt for the exit the judge signed. Delivers the spot leg
    /// and pays its reward once (no reward for a residual exit after the rescue).
    pub fn confirm_exit(&mut self, now: u64, receipt: &Log) -> Result<Outcome, Error> {
        self.transact(|s| s.confirm_exit_inner(now, receipt))
    }

    fn confirm_exit_inner(&mut self, now: u64, receipt: &Log) -> Result<Outcome, Error> {
        if !matches!(self.mode, Mode::Flattening | Mode::Flattened) {
            return Err(Error::Mandate("no-exit-signed"));
        }
        if self.used.contains(&receipt.id()) {
            return Err(Error::EvidenceReused);
        }
        let c = &self.config;
        if receipt.emitter != c.spot_account {
            return Err(Error::BadEvidence("emitter"));
        }
        let x = decode_exited(receipt, c.spot_chain)?;
        if x.token != c.spot_token || Some(x.payout) != c.investor || x.amount == 0 {
            return Err(Error::BadEvidence("exit-receipt"));
        }
        match &self.rescue.exit {
            Some(e) if e.nonce == x.nonce => {}
            _ => return Err(Error::UnknownSignedAction),
        }
        self.used.insert(receipt.id());
        self.rescue.exit = None;
        self.rescue.vault_nonce = x.nonce + 1;
        let d = Delivery { leg: Leg::Spot, amount: x.amount, evidence: receipt.id(), at: now, cycle: self.cycle };
        self.rescue.deliveries.push(d.clone());
        let mut st = Step { delivered: vec![d], ..Step::default() };

        if self.mode == Mode::Flattened {
            return Ok(Outcome::Residual { sweep: None, exit: None, delivered: st.delivered });
        }
        self.rescue.spot = LegStatus::Delivered;
        let reward = self.policy().spot_reward;
        // The reward goes to the guardian answerable for the rescue: the open job's agent, or the
        // last one's if it has expired since (paid from the pool then).
        let mut job = match self.job.clone() {
            Some(j) => j,
            None => self.last_rescue_job()?,
        };
        st.paid.extend(self.pay(&mut job, reward, "spot"));
        if self.rescue.perp.done() {
            return Ok(self.finish(job, st));
        }
        if self.job.is_some() {
            self.job = Some(job.clone());
        }
        Ok(self.outcome(&job, st, false))
    }

    /// Anyone, after the rescue: whatever is left on, or arrives later at, either leg goes to the
    /// investor. No reward.
    pub fn sweep(&mut self, now: u64, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        self.transact(|s| {
            if s.mode != Mode::Flattened {
                return Err(Error::Mandate("sweep-only-after-exit"));
            }
            let ev = s.evidence(now, perp, spot, true)?;
            match s.rescue.sweep.clone() {
                Some(w) => {
                    s.resolve(&ev.perp, w.nonce, w.deadline)?;
                }
                None if ev.perp.last_nonce != s.nonce => return Err(Error::UnknownSignedAction),
                None => {}
            }
            s.rescue.sweep = None;
            s.nonce = ev.perp.last_nonce;
            let sweep = (!s.leg_empty(&ev)).then(|| s.sign_sweep(now, &ev));
            let exit_stale = s.rescue.exit.as_ref().is_none_or(|x| ev.spot.timestamp > x.deadline);
            let exit = (s.spot_1e8(ev.spot.balance) > s.policy().dust as i128 && exit_stale).then(|| s.sign_exit(now));
            if sweep.is_none() && exit.is_none() {
                return Err(Error::Mandate("nothing-left"));
            }
            s.used.insert(ev.ids[0]);
            Ok(Outcome::Residual { sweep, exit, delivered: vec![] })
        })
    }

    // ---------- helpers ----------

    /// The leg holds no USDC worth sweeping (a negative account value counts as empty).
    fn leg_empty(&self, ev: &Evidence) -> bool {
        let dust = self.policy().usdc_dust_usd6;
        ev.perp.account_value <= dust as i64 && ev.perp.spot_usdc <= dust * 100
    }

    fn sign_sweep(&mut self, now: u64, ev: &Evidence) -> SweepPlan {
        let ntl = ev.perp.account_value.max(0) as u64;
        let wei = ntl * 100 + ev.perp.spot_usdc;
        self.rescue.owed.get_or_insert(Owed { usdc_wei: wei, payout_before: ev.perp.payout_usdc });
        let sweep = Sweep { nonce: ev.perp.last_nonce, usd_ntl: ntl, usdc_wei: wei, deadline: now + self.policy().order_ttl_s };
        self.rescue.sweep = Some(SweepState { nonce: sweep.nonce, deadline: sweep.deadline, usd_ntl: ntl, usdc_wei: wei });
        let digest = Bytes(sweep_digest(self.config.chain_id, &self.config.leg, &sweep));
        SweepPlan { sweep, digest }
    }

    fn sign_exit(&mut self, now: u64) -> ExitPlan {
        let exit = Exit { nonce: self.rescue.vault_nonce, token: self.config.spot_token, deadline: now + self.policy().order_ttl_s };
        self.rescue.exit = Some(ExitState { nonce: exit.nonce, deadline: exit.deadline });
        let digest = Bytes(exit_digest(self.config.spot_chain_id, &self.config.spot_account, &exit));
        ExitPlan { exit, digest }
    }

    /// The most recent rescue job's agent, as a zero-reserve job (rewards then come from the pool).
    fn last_rescue_job(&self) -> Result<Job, Error> {
        let agent = self.rescue.agent.clone().ok_or(Error::NoOpenJob)?;
        Ok(Job {
            id: self.next_job_id - 1,
            kind: JobKind::Flatten,
            agent,
            opened_at: 0,
            expires_at: 0,
            pre_spot_wei: 0,
            signed: 0,
            failed: 0,
            loss_used_usd6: 0,
            attempt: None,
            reserved: 0,
            target_1e8: 0,
        })
    }

    fn finish(&mut self, job: Job, st: Step) -> Outcome {
        self.rescue.agent = Some(job.agent.clone());
        self.job = Some(job.clone());
        self.release();
        self.mode = Mode::Flattened;
        self.outcome(&job, st, true)
    }

    /// End this job without finishing: its unpaid reserve returns to the pool and the exit stays
    /// triggered for the next guardian. Signatures already issued stay valid.
    fn end_job(&mut self, job: Job, st: Step) -> Outcome {
        self.rescue.agent = Some(job.agent.clone());
        self.job = Some(job.clone());
        self.release();
        self.outcome(&job, st, false)
    }

    fn outcome(&mut self, job: &Job, st: Step, done: bool) -> Outcome {
        if self.mode == Mode::Flattening {
            self.rescue.agent = Some(job.agent.clone());
        }
        Outcome::Rescue {
            job_id: job.id,
            trigger: self.rescue.trigger.expect("set when the exit opened"),
            order: st.order,
            sweep: st.sweep,
            exit: st.exit,
            delivered: st.delivered,
            paid: st.paid,
            perp: self.rescue.perp,
            spot: self.rescue.spot,
            ended: st.ended,
            done,
        }
    }
}
