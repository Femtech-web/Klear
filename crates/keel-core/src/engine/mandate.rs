//! The powers of the manager and of the investor, and what may trigger an exit.
//!
//! The manager can only propose orders and send heartbeats. The investor can only ask for an exit;
//! it cannot redirect funds (both legs pay out to immutable addresses) or change the mandate.

use super::{Attempt, Evidence, Mode, OnSilence, Outcome, Strategy, Trigger, Valuation};
use crate::eip712::{order_digest, Order};
use crate::evidence::Log;
use crate::px::{lot, oracle_1e8, valid_px, E8};
use crate::{rules, Bytes, Error};

impl Strategy {
    /// The manager proposes one order. It is signed only if, on attested state: no exit is
    /// triggered, the market is not dislocated, the size and price fit the bounds, and the
    /// post-trade leverage against the liquidation value is within the mandate (orders that only
    /// reduce exposure always pass, and are signed reduce-only).
    #[allow(clippy::too_many_arguments)]
    pub fn propose(&mut self, now: u64, caller: &str, perp: &Log, spot: &Log, is_buy: bool, sz: u64, limit_px: u64) -> Result<Outcome, Error> {
        self.transact(|s| s.propose_inner(now, caller, perp, spot, is_buy, sz, limit_px))
    }

    #[allow(clippy::too_many_arguments)]
    fn propose_inner(&mut self, now: u64, caller: &str, perp: &Log, spot: &Log, is_buy: bool, sz: u64, limit_px: u64) -> Result<Outcome, Error> {
        self.check_manager(caller)?;
        if self.mode != Mode::Active || self.job.is_some() || self.exit_requested {
            return Err(Error::Mandate("strategy-not-active"));
        }
        let ev = self.evidence(now, perp, spot, true)?;
        match &self.pending {
            Some(p) => {
                self.resolve(&ev.perp, p.order.nonce, p.order.deadline)?;
            }
            None => {
                if ev.perp.last_nonce != self.nonce {
                    return Err(Error::UnknownSignedAction);
                }
                if !self.settled(&ev.perp) {
                    return Err(Error::SnapshotNotSettled);
                }
            }
        }
        let p = self.policy();
        let oracle = oracle_1e8(ev.perp.oracle_raw, p.sz_decimals).filter(|o| *o > 0).ok_or(Error::BadPrice)?;
        let mark = oracle_1e8(ev.perp.mark_raw, p.sz_decimals).filter(|m| *m > 0).ok_or(Error::BadPrice)?;
        if (oracle.abs_diff(mark) as u128 * 10_000).div_ceil(oracle as u128) > p.max_basis_bp as u128 {
            return Err(Error::MarketDislocated);
        }
        let val = self.valuation(&ev)?;
        if val.below_floor {
            return Err(Error::Mandate("equity-below-floor"));
        }
        if self.silent(now) && p.on_silence == OnSilence::Exit {
            // The investor chose to exit on silence and the window has passed: a late manager may
            // not race the guardians.
            return Err(Error::Mandate("manager-silent"));
        }
        let l = lot(p.sz_decimals);
        if sz == 0 || sz > p.max_order_sz || sz % l != 0 {
            return Err(Error::Mandate("size"));
        }
        if !valid_px(limit_px, p.sz_decimals) || limit_px.abs_diff(mark) as u128 * 10_000 > mark as u128 * p.band_bp as u128 {
            return Err(Error::Mandate("price-outside-band"));
        }
        let cur = self.perp_1e8(ev.perp.szi);
        let next = if is_buy { cur + sz as i128 } else { cur - sz as i128 };
        let reduces = next.unsigned_abs() < cur.unsigned_abs() && next.signum() * cur.signum() >= 0;
        if !reduces {
            let notional_usd6 = next.unsigned_abs() * mark as u128 / E8 as u128 / 100;
            if !rules::within_leverage(notional_usd6, val.total_usd6 as i128, p.max_leverage_bp) {
                return Err(Error::Mandate("leverage"));
            }
        }
        let nonce = ev.perp.last_nonce;
        let order = Order {
            nonce,
            is_buy,
            limit_px,
            sz,
            reduce_only: reduces,
            cloid: self.cloid(b"keel/manager", 0, nonce),
            deadline: now + p.order_ttl_s,
        };
        let digest = Bytes(order_digest(self.config.chain_id, &self.config.leg, &order));
        self.pending = Some(Attempt { order: order.clone(), digest, signed_at: now, pre_szi_1e8: cur, pre_entry_ntl: ev.perp.entry_ntl, worst_loss_usd6: 0 });
        self.nonce = nonce;
        self.last_heartbeat = now;
        self.used.insert(ev.ids[0]);
        Ok(Outcome::Sign { job_id: 0, order, digest })
    }

    /// The manager: a sign of life.
    pub fn heartbeat(&mut self, now: u64, caller: &str) -> Result<(), Error> {
        self.transact(|s| {
            s.check_manager(caller)?;
            s.last_heartbeat = now;
            Ok(())
        })
    }

    /// The investor's NEAR account: an exit, at any time and for any reason.
    pub fn request_exit(&mut self, caller: &str) -> Result<(), Error> {
        self.transact(|s| {
            let investor = s.config.investor_account.as_deref().ok_or(Error::Mandate("no-investor-account"))?;
            if caller != investor {
                return Err(Error::Mandate("not-the-investor"));
            }
            if matches!(s.mode, Mode::Frozen | Mode::Flattened) {
                return Err(Error::Mandate("strategy-closed"));
            }
            s.exit_requested = true;
            Ok(())
        })
    }

    /// The investor's NEAR account, after a completed rescue: start the strategy again on the same accounts
    /// (fund them first). The mandate, the payouts and the delivery history are unchanged; the vault's and
    /// KeelLeg's nonces carry on.
    pub fn rearm(&mut self, now: u64, caller: &str) -> Result<(), Error> {
        self.transact(|s| {
            let investor = s.config.investor_account.as_deref().ok_or(Error::Mandate("no-investor-account"))?;
            if caller != investor {
                return Err(Error::Mandate("not-the-investor"));
            }
            if s.mode != Mode::Flattened {
                return Err(Error::Mandate("rearm-only-after-a-rescue"));
            }
            let vault_nonce = s.rescue.vault_nonce;
            let deliveries = std::mem::take(&mut s.rescue.deliveries);
            s.rescue = Default::default();
            s.rescue.vault_nonce = vault_nonce;
            s.rescue.deliveries = deliveries;
            s.mode = Mode::Active;
            s.exit_requested = false;
            s.job = None;
            s.cycle += 1;
            s.last_heartbeat = now;
            Ok(())
        })
    }

    fn check_manager(&self, caller: &str) -> Result<(), Error> {
        let manager = self.config.manager.as_deref().ok_or(Error::Mandate("no-manager"))?;
        if caller != manager {
            return Err(Error::Mandate("not-the-manager"));
        }
        Ok(())
    }

    /// Whether the manager has missed its heartbeat window (never, without a heartbeat policy).
    pub fn silent(&self, now: u64) -> bool {
        let h = self.policy().heartbeat_s;
        h > 0 && now > self.last_heartbeat + h
    }

    /// Why an exit may open now, if it may: the investor asked, repair was exhausted, the
    /// liquidation value is below the floor, or the manager is silent and the investor chose to
    /// exit on silence. An exit already under way stays triggered.
    pub(crate) fn exit_trigger(&self, now: u64, val: &Valuation) -> Option<Trigger> {
        if self.mode == Mode::Flattening {
            return self.rescue.trigger;
        }
        if self.exit_requested {
            Some(Trigger::Investor)
        } else if self.mode == Mode::RepairExhausted {
            Some(Trigger::RepairExhausted)
        } else if val.below_floor {
            Some(Trigger::Floor)
        } else if self.silent(now) && self.policy().on_silence == OnSilence::Exit {
            Some(Trigger::ManagerSilent)
        } else {
            None
        }
    }

    /// The liquidation value on two attested logs, without consuming them (a view for guardians,
    /// the manager and the investor).
    pub fn valuation_of(&self, now: u64, perp: &Log, spot: &Log) -> Result<(Valuation, Option<Trigger>), Error> {
        // A view: cited evidence may already be consumed; it must still be fresh and well-formed.
        let mut unspent = self.clone();
        unspent.used.clear();
        let ev: Evidence = unspent.evidence(now, perp, spot, true)?;
        let val = self.valuation(&ev)?;
        let trigger = self.exit_trigger(now, &val);
        Ok((val, trigger))
    }
}
