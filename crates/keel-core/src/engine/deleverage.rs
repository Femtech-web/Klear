//! Deleveraging: an early, bounded risk cut before the floor. When the liquidation value falls under the
//! investor's warning level, or the position has drifted above the leverage cap (prices moved, no order
//! did), anyone may cut it back to the investor's target leverage with reduce-only orders the judge
//! plans. The reward is paid once, on a settled snapshot showing the position at or under the target.
//! The floor rescue stays the backstop: below the floor this job cannot open.

use super::{Job, JobKind, Mode, Outcome, Strategy, Valuation};
use crate::evidence::{Log, PerpSnapshot};
use crate::px::{lot, oracle_1e8, E8};
use crate::{rules, Error};

impl Strategy {
    /// Why a deleverage may open now, if it may (none without a target, and none below the floor).
    pub(crate) fn delever_due(&self, s: &PerpSnapshot, val: &Valuation) -> Option<&'static str> {
        let p = self.policy();
        if p.delever_target_bp == 0 || val.below_floor {
            return None;
        }
        if p.warn_usd6 > 0 && val.total_usd6 < p.warn_usd6 as i64 {
            return Some("early-warning");
        }
        let mark = oracle_1e8(s.mark_raw, p.sz_decimals)? as u128;
        let gross = self.perp_1e8(s.szi).unsigned_abs() * mark / E8 as u128 / 100;
        (p.max_leverage_bp > 0 && !rules::within_leverage(gross, val.total_usd6 as i128, p.max_leverage_bp)).then_some("leverage-drift")
    }

    /// The position size (1e8 units, rounded down to a lot) at the target leverage on this valuation.
    fn delever_target(&self, s: &PerpSnapshot, val: &Valuation) -> Result<u64, Error> {
        let p = self.policy();
        let mark = oracle_1e8(s.mark_raw, p.sz_decimals).filter(|m| *m > 0).ok_or(Error::BadPrice)? as u128;
        let notional = val.total_usd6.max(0) as u128 * p.delever_target_bp as u128 / 10_000;
        let l = lot(p.sz_decimals) as u128;
        Ok((notional * 100 * E8 as u128 / mark / l * l) as u64)
    }

    /// Any agent but the manager: open a deleverage on evidence showing it is due.
    pub fn open_deleverage(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        self.transact(|s| s.open_deleverage_inner(now, agent, perp, spot))
    }

    fn open_deleverage_inner(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        if self.mode != Mode::Active || self.exit_requested {
            return Err(Error::Mandate("strategy-not-active"));
        }
        if self.config.manager.as_deref() == Some(agent) {
            return Err(Error::Mandate("manager-cannot-guard"));
        }
        let ev = self.evidence(now, perp, spot, true)?;
        let val = self.valuation(&ev)?;
        self.delever_due(&ev.perp, &val).ok_or(Error::Mandate("deleverage-not-due"))?;
        let released = self.clear_to_open(now, JobKind::Deleverage, &ev)?;
        let reward = self.policy().delever_reward;
        if self.pool + released < reward {
            return Err(Error::RewardPoolEmpty);
        }
        let mut job = Job {
            id: self.next_job_id,
            kind: JobKind::Deleverage,
            agent: agent.to_string(),
            opened_at: now,
            expires_at: now + self.policy().job_ttl_s,
            pre_spot_wei: ev.spot.balance,
            signed: 1,
            failed: 0,
            loss_used_usd6: 0,
            attempt: None,
            reserved: reward,
            target_1e8: self.delever_target(&ev.perp, &val)?,
        };
        let attempt = self.plan(now, &job, &ev.perp, ev.spot.balance)?.ok_or(Error::WithinTolerance)?;
        job.loss_used_usd6 = attempt.worst_loss_usd6;
        let out = Outcome::Sign { job_id: job.id, order: attempt.order.clone(), digest: attempt.digest };
        job.attempt = Some(attempt);

        self.release();
        self.pool -= reward;
        self.pending = None;
        self.nonce = ev.perp.last_nonce;
        self.used.insert(ev.ids[0]);
        self.next_job_id += 1;
        self.mode = Mode::Deleveraging;
        self.job = Some(job);
        Ok(out)
    }

    /// A settled snapshot after the attempt: paid once the position is at or under the target; otherwise
    /// the next reduce-only order, or the job ends unpaid.
    pub(crate) fn settle_deleverage(&mut self, now: u64, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        let mut job = self.job.clone().ok_or(Error::NoOpenJob)?;
        let a = job.attempt.clone().ok_or(Error::NoOpenJob)?;
        let ev = self.evidence(now, perp, spot, true)?;
        let executed = self.resolve(&ev.perp, a.order.nonce, a.order.deadline)?;
        let post = self.perp_1e8(ev.perp.szi);
        self.used.insert(ev.ids[0]);
        self.nonce = ev.perp.last_nonce;

        if let Some(out) = self.check_execution(&job, &a, &ev.perp, post, executed) {
            return Ok(out);
        }
        let p = self.policy().clone();
        if post.unsigned_abs() <= job.target_1e8 as u128 + p.dust as u128 {
            let payout = self.pay(&mut job, p.delever_reward, "deleverage");
            self.job = Some(job.clone());
            self.release();
            self.mode = Mode::Active;
            return Ok(match payout {
                Some(payout) => Outcome::Repaired { job_id: job.id, payout },
                None => Outcome::Voided { job_id: job.id, reason: "done-unfunded".into() },
            });
        }
        if executed {
            job.failed += 1;
        } else {
            job.loss_used_usd6 = job.loss_used_usd6.saturating_sub(a.worst_loss_usd6);
        }
        if job.failed >= p.max_failed_attempts {
            self.release();
            self.mode = Mode::Active;
            return Ok(Outcome::Exhausted { job_id: job.id, reason: "attempts".into() });
        }
        if now >= job.expires_at {
            return Ok(self.void(job.id, "job-expired"));
        }
        match self.plan(now, &job, &ev.perp, ev.spot.balance) {
            Ok(Some(next)) => {
                job.signed += 1;
                job.loss_used_usd6 += next.worst_loss_usd6;
                let out = Outcome::Sign { job_id: job.id, order: next.order.clone(), digest: next.digest };
                job.attempt = Some(next);
                self.job = Some(job);
                Ok(out)
            }
            Ok(None) => Ok(self.void(job.id, "already-at-target")),
            Err(Error::LossBudgetExhausted) => {
                self.release();
                self.mode = Mode::Active;
                Ok(Outcome::Exhausted { job_id: job.id, reason: "loss-budget".into() })
            }
            Err(Error::MarketDislocated) => Ok(self.void(job.id, "market-dislocated")),
            Err(e) => Ok(self.freeze(&e.code())),
        }
    }
}
