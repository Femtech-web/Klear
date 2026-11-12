//! Hedge repair: any agent may restore a broken hedge (e.g. after ADL) with bounded orders the
//! judge computes, and is paid once, on a settled snapshot showing the hedge back in tolerance with
//! the spot leg untouched.

use super::{Job, JobKind, Mode, Outcome, Strategy};
use crate::evidence::Log;
use crate::Error;

impl Strategy {
    /// Any agent: open a repair job from attested state showing a broken hedge.
    pub fn open_repair(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        self.transact(|s| s.open_repair_inner(now, agent, perp, spot))
    }

    fn open_repair_inner(&mut self, now: u64, agent: &str, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        match self.mode {
            Mode::Frozen => return Err(Error::Frozen),
            Mode::Flattening | Mode::Flattened => return Err(Error::FlattenInProgress),
            _ if self.exit_requested => return Err(Error::FlattenInProgress),
            _ => {}
        }
        if !self.policy().hedge {
            return Err(Error::Mandate("no-hedge-rule"));
        }
        let ev = self.evidence(now, perp, spot, false)?;
        let released = self.clear_to_open(now, JobKind::Repair, &ev)?;
        let reward = self.policy().repair_reward;
        if self.pool + released < reward {
            return Err(Error::RewardPoolEmpty);
        }
        let mut job = Job {
            id: self.next_job_id,
            kind: JobKind::Repair,
            agent: agent.to_string(),
            opened_at: now,
            expires_at: now + self.policy().job_ttl_s,
            pre_spot_wei: ev.spot.balance,
            signed: 1,
            failed: 0,
            loss_used_usd6: 0,
            attempt: None,
            reserved: reward,
            target_1e8: 0,
        };
        let attempt = self.plan(now, &job, &ev.perp, ev.spot.balance)?.ok_or(Error::WithinTolerance)?;
        job.loss_used_usd6 = attempt.worst_loss_usd6;
        let out = Outcome::Sign { job_id: job.id, order: attempt.order.clone(), digest: attempt.digest };
        job.attempt = Some(attempt);

        self.release();
        self.pool -= reward;
        self.pending = None;
        self.nonce = ev.perp.last_nonce;
        self.used.extend(ev.ids);
        self.next_job_id += 1;
        self.mode = Mode::Repairing;
        self.job = Some(job);
        Ok(out)
    }

    /// A settled snapshot and a spot balance read after the attempt was signed: pays the agent once
    /// if the hedge is back within tolerance; otherwise signs the next attempt or ends the job.
    pub(crate) fn settle_repair(&mut self, now: u64, perp: &Log, spot: &Log) -> Result<Outcome, Error> {
        let mut job = self.job.clone().ok_or(Error::NoOpenJob)?;
        let a = job.attempt.clone().ok_or(Error::NoOpenJob)?;
        let ev = self.evidence(now, perp, spot, false)?;
        let executed = self.resolve(&ev.perp, a.order.nonce, a.order.deadline)?;
        if ev.spot.timestamp < a.signed_at {
            return Err(Error::StaleEvidence);
        }
        let p = self.policy().clone();
        let spot = self.spot_1e8(ev.spot.balance);
        let post = self.perp_1e8(ev.perp.szi);

        // The evidence is consumed from here on; every branch changes state.
        self.used.extend(ev.ids);
        self.nonce = ev.perp.last_nonce;

        if let Some(out) = self.check_execution(&job, &a, &ev.perp, post, executed) {
            return Ok(out);
        }
        if ev.spot.balance != job.pre_spot_wei {
            return Ok(self.void(job.id, "spot-leg-changed"));
        }
        let delta = spot + post;
        let overshot = if spot + a.pre_szi_1e8 > 0 { delta < -(p.tolerance as i128) } else { delta > p.tolerance as i128 };
        if overshot {
            return Ok(self.freeze("repair-overshot-target"));
        }
        if delta.unsigned_abs() <= p.tolerance as u128 {
            let payout = self.pay(&mut job, p.repair_reward, "repair").expect("reserved at open");
            self.job = Some(job);
            self.release();
            self.mode = Mode::Active;
            return Ok(Outcome::Repaired { job_id: payout.job_id, payout });
        }

        if executed {
            job.failed += 1;
        } else {
            // The order expired without being relayed and never cost anything.
            job.loss_used_usd6 = job.loss_used_usd6.saturating_sub(a.worst_loss_usd6);
        }
        if job.failed >= p.max_failed_attempts {
            return Ok(self.exhaust_repair(job.id, "attempts"));
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
            Ok(None) => unreachable!("an out-of-tolerance hedge always has an order"),
            Err(Error::LossBudgetExhausted) => Ok(self.exhaust_repair(job.id, "loss-budget")),
            // Not the job's fault and not permanent: end it unpaid; a new job can open later.
            Err(Error::MarketDislocated) => Ok(self.void(job.id, "market-dislocated")),
            Err(e) => Ok(self.freeze(&e.code())),
        }
    }

    fn exhaust_repair(&mut self, job_id: u64, reason: &str) -> Outcome {
        self.release();
        self.mode = Mode::RepairExhausted;
        Outcome::Exhausted { job_id, reason: reason.into() }
    }
}
