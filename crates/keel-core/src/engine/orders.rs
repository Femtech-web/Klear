//! Bounded IOC orders: the one order a job's attested state calls for, and the check that what
//! HyperCore did is something that order allows.

use super::{Attempt, Job, JobKind, Outcome, Strategy};
use crate::eip712::{order_digest, Order};
use crate::evidence::PerpSnapshot;
use crate::px::{lot, oracle_1e8, round_px, E8};
use crate::{keccak, Bytes, Error};

impl Strategy {
    /// The one order the attested state calls for, or None if the job has nothing left to do on
    /// the perp leg. The agent chooses nothing: size is capped by the per-order cap and the job's
    /// remaining loss budget (charged at the full band plus fees and basis), and the limit sits at
    /// half the band around the snapshot's mark.
    pub(crate) fn plan(&self, now: u64, job: &Job, s: &PerpSnapshot, spot_wei: u128) -> Result<Option<Attempt>, Error> {
        let p = self.policy();
        let spot = self.spot_1e8(spot_wei);
        let perp = self.perp_1e8(s.szi);
        let (is_buy, reduce_only, need) = match job.kind {
            JobKind::Repair => {
                if perp > 0 {
                    return Err(Error::UnexpectedLong);
                }
                let delta = spot + perp;
                if delta.unsigned_abs() <= p.tolerance as u128 {
                    return Ok(None);
                }
                if delta > 0 {
                    (false, false, delta as u128)
                } else {
                    (true, true, delta.unsigned_abs())
                }
            }
            JobKind::Flatten => {
                if perp.unsigned_abs() <= p.dust as u128 {
                    return Ok(None);
                }
                (perp < 0, true, perp.unsigned_abs())
            }
            JobKind::Deleverage => {
                let excess = perp.unsigned_abs().saturating_sub(job.target_1e8 as u128);
                if excess <= p.dust as u128 {
                    return Ok(None);
                }
                (perp < 0, true, excess)
            }
        };
        let oracle = oracle_1e8(s.oracle_raw, p.sz_decimals).filter(|o| *o > 0).ok_or(Error::BadPrice)?;
        let mark = oracle_1e8(s.mark_raw, p.sz_decimals).filter(|m| *m > 0).ok_or(Error::BadPrice)?;
        // Basis in bp of the oracle, rounded up; it is charged to the loss budget with the band.
        let basis_bp = ((oracle.abs_diff(mark) as u128 * 10_000).div_ceil(oracle as u128)) as u64;
        if basis_bp > p.max_basis_bp as u64 {
            return Err(Error::MarketDislocated);
        }
        let cost_bp = (p.band_bp as u64 + p.fee_bp as u64 + basis_bp) as u128;
        let budget = p.max_loss_usd6.saturating_sub(job.loss_used_usd6) as u128;
        // worst_usd6(sz) = sz * px / 1e8 / 100 * cost_bp / 1e4, solved for sz.
        let by_loss = budget * 100 * E8 as u128 * 10_000 / (mark.max(oracle) as u128 * cost_bp);
        let l = lot(p.sz_decimals) as u128;
        let sz = need.min(p.max_order_sz as u128).min(by_loss) / l * l;
        if sz == 0 {
            return Err(Error::LossBudgetExhausted);
        }
        let offset = p.band_bp as u64 / 2;
        let limit_px = if is_buy {
            round_px(mark * (10_000 + offset) / 10_000, p.sz_decimals, false)
        } else {
            round_px(mark * (10_000 - offset) / 10_000, p.sz_decimals, true)
        }
        .ok_or(Error::BadPrice)?;
        let worst = sz * mark.max(oracle) as u128 / E8 as u128 * cost_bp / 100 / 10_000;

        let nonce = s.last_nonce;
        let order = Order {
            nonce,
            is_buy,
            limit_px,
            sz: sz as u64,
            reduce_only,
            cloid: self.cloid(b"keel/cloid", job.id, nonce),
            deadline: now + p.order_ttl_s,
        };
        let digest = Bytes(order_digest(self.config.chain_id, &self.config.leg, &order));
        Ok(Some(Attempt {
            order,
            digest,
            signed_at: now,
            pre_szi_1e8: perp,
            pre_entry_ntl: s.entry_ntl,
            worst_loss_usd6: worst as u64,
        }))
    }

    /// A deterministic client order id, so an order's fills can be traced to the job that signed it.
    pub(crate) fn cloid(&self, domain: &[u8], job_id: u64, nonce: u64) -> u128 {
        let mut seed = domain.to_vec();
        seed.extend_from_slice(&self.config.strategy_id.to_be_bytes());
        seed.extend_from_slice(&job_id.to_be_bytes());
        seed.extend_from_slice(&nonce.to_be_bytes());
        u128::from_be_bytes(keccak(&seed)[..16].try_into().unwrap()).max(1)
    }

    /// Compare the position change with the attempt's order. A change the order cannot explain
    /// in the direction of an exchange-side event (ADL, liquidation: both only shrink a position)
    /// voids the job; a change no signed order allows freezes the strategy.
    pub(crate) fn check_execution(&mut self, job: &Job, a: &Attempt, s: &PerpSnapshot, post: i128, executed: bool) -> Option<Outcome> {
        let o = &a.order;
        let pre = a.pre_szi_1e8;
        let moved = post - pre;
        let shrank = post.unsigned_abs() < pre.unsigned_abs() && post.signum() * pre.signum() >= 0;
        if !executed {
            return match moved {
                0 => None,
                _ if shrank => Some(self.void(job.id, "position-changed-externally")),
                _ => Some(self.freeze("position-changed-without-order")),
            };
        }
        if post.signum() * pre.signum() < 0 {
            return Some(self.freeze("position-flipped"));
        }
        let with_order = if o.is_buy { moved >= 0 } else { moved <= 0 };
        if !with_order || moved.unsigned_abs() > o.sz as u128 {
            return Some(if shrank {
                self.void(job.id, "position-changed-externally")
            } else {
                self.freeze("fill-exceeds-order")
            });
        }
        // A sell that grows a short adds exactly its fill notional to entryNtl, so the average
        // fill price is observable; it must not be below the limit (one tick of rounding).
        if !o.is_buy && moved < 0 && pre <= 0 {
            let added_usd6 = s.entry_ntl as i128 - a.pre_entry_ntl as i128;
            let avg_px = added_usd6 * 100 * E8 as i128 / -moved;
            if avg_px + 10i128.pow(2 + self.policy().sz_decimals as u32) < o.limit_px as i128 {
                return Some(self.freeze("fill-below-limit"));
            }
        }
        None
    }
}
