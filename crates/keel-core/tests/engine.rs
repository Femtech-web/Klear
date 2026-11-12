//! Judge rules on synthetic logs. These logs are encoded here, not read from any chain.

use keel_core::abi::{enc_address, enc_u128, enc_u64};
use keel_core::eip712::{exit_digest, sweep_digest, Order};
use keel_core::engine::{Config, LegStatus, Mode, OnSilence, Outcome, Policy, Strategy, Trigger};
use keel_core::evidence::{Chain, Log, BALANCE_SIG, EXITED_SIG, SNAPSHOT_SIG, SNAPSHOT_SIG_V5};
use keel_core::{keccak, Address, Bytes, Error};

const NOW: u64 = 1_800_000_000;
const ETH: i64 = 10_000; // szi units
const WEI: u128 = 1_000_000_000_000_000_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const LEG: u8 = 0x11;
const TOKEN: u8 = 0x33;
const VAULT: u8 = 0x44;
const INVESTOR: u8 = 0x77;

fn addr(b: u8) -> Address {
    Bytes([b; 20])
}

fn policy() -> Policy {
    Policy {
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
        repair_reward: NEAR,
        flatten_reward: 2 * NEAR,
        spot_reward: NEAR,
        max_leverage_bp: 0,
        equity_floor_usd6: 0,
        spot_haircut_bp: 0,
        usdc_dust_usd6: 10_000,
        hedge: true,
        heartbeat_s: 0,
        on_silence: OnSilence::Nothing,
        warn_usd6: 0,
        delever_target_bp: 0,
        delever_reward: NEAR / 2,
    }
}

/// The spot leg is a KeelVault (it is both the account and the evidence emitter); exits pay the
/// investor.
fn config(p: Policy) -> Config {
    Config {
        strategy_id: 7,
        chain_id: 998,
        leg: addr(LEG),
        spot_account: addr(VAULT),
        spot_token: addr(TOKEN),
        probe: addr(VAULT),
        spot_chain: Chain::Base,
        spot_chain_id: 84532,
        manager: None,
        investor: Some(addr(INVESTOR)),
        investor_account: Some("investor.testnet".into()),
        policy: p,
    }
}

fn strategy(p: Policy) -> Strategy {
    Strategy::new(config(p), 10 * NEAR, NOW).unwrap()
}

struct World {
    szi: i64,
    entry: u64,
    oracle_raw: u64,
    mark_raw: u64,
    account_value: i64,
    /// KeelLeg's and the payout's HyperCore spot USDC (1e8 per dollar).
    leg_usdc: u64,
    payout_usdc: u64,
    l1: u64,
    nonce: u64,
    queued: u64,
    spot: u128,
    ts: u64,
    seq: u64,
}

fn word_i64(v: i64) -> [u8; 32] {
    let mut w = [if v < 0 { 0xff } else { 0 }; 32];
    w[24..].copy_from_slice(&v.to_be_bytes());
    w
}

impl World {
    fn hedged() -> Self {
        // 1 ETH spot, 1 ETH short at 3000, nothing signed yet.
        World {
            szi: -ETH,
            entry: 3_000_000_000,
            oracle_raw: 300_000,
            mark_raw: 300_000,
            account_value: 30_000_000,
            leg_usdc: 0,
            payout_usdc: 500_000_000,
            l1: 1_000,
            nonce: 0,
            queued: 0,
            spot: WEI,
            ts: NOW,
            seq: 0,
        }
    }

    fn id(&mut self) -> Bytes<32> {
        self.seq += 1;
        Bytes(keccak(&self.seq.to_be_bytes()))
    }

    /// A KeelLeg v6 snapshot.
    fn perp(&mut self) -> Log {
        let mut d = Vec::new();
        d.extend_from_slice(&enc_u64(4));
        d.extend_from_slice(&word_i64(self.szi));
        for v in [self.entry, self.oracle_raw, self.mark_raw] {
            d.extend_from_slice(&enc_u64(v));
        }
        d.extend_from_slice(&word_i64(self.account_value));
        for v in [self.leg_usdc, self.payout_usdc, self.l1, self.nonce, self.queued, 5_000, self.ts] {
            d.extend_from_slice(&enc_u64(v));
        }
        d.extend_from_slice(&[0u8; 32]);
        Log {
            chain: Chain::HyperEvm,
            tx: self.id(),
            log_index: 0,
            emitter: addr(LEG),
            topics: vec![Bytes(keccak(SNAPSHOT_SIG.as_bytes())), Bytes(enc_address(&addr(LEG).0))],
            data: d,
        }
    }

    /// The vault's `Balance` record.
    fn spot(&mut self) -> Log {
        let mut d = Vec::new();
        d.extend_from_slice(&enc_u128(self.spot));
        d.extend_from_slice(&enc_u64(9_000));
        d.extend_from_slice(&enc_u64(self.ts));
        d.extend_from_slice(&[0u8; 32]);
        Log {
            chain: Chain::Base,
            tx: self.id(),
            log_index: 3,
            emitter: addr(VAULT),
            topics: vec![
                Bytes(keccak(BALANCE_SIG.as_bytes())),
                Bytes(enc_address(&addr(VAULT).0)),
                Bytes(enc_address(&addr(TOKEN).0)),
            ],
            data: d,
        }
    }

    /// The vault's `Exited` receipt: its whole balance went to `payout`.
    fn exited(&mut self, nonce: u64, payout: u8) -> Log {
        let amount = self.spot;
        self.spot = 0;
        let mut d = Vec::new();
        d.extend_from_slice(&enc_address(&addr(payout).0));
        d.extend_from_slice(&enc_u128(amount));
        d.extend_from_slice(&enc_u64(9_100));
        d.extend_from_slice(&enc_u64(self.ts));
        Log {
            chain: Chain::Base,
            tx: self.id(),
            log_index: 1,
            emitter: addr(VAULT),
            topics: vec![Bytes(keccak(EXITED_SIG.as_bytes())), Bytes(enc_u64(nonce)), Bytes(enc_address(&addr(TOKEN).0))],
            data: d,
        }
    }

    /// KeelLeg accepted a signed action: nonce advances and it is queued.
    fn relay(&mut self) {
        self.nonce += 1;
        self.queued = self.l1;
    }

    /// HyperCore executes it and enough blocks pass for a settled snapshot.
    fn fill(&mut self, d_szi: i64, px_usd6_per_eth: u64) {
        if d_szi < 0 && self.szi <= 0 {
            self.entry += (-d_szi) as u64 * px_usd6_per_eth / ETH as u64;
        } else if self.szi != 0 {
            let abs = self.szi.unsigned_abs();
            let next = (self.szi + d_szi).unsigned_abs();
            self.entry = self.entry * next / abs;
        }
        self.szi += d_szi;
        self.advance();
    }

    /// A relayed sweep runs: margin to spot, then (unless the send fails) spot to the payout.
    fn sweep_runs(&mut self, send_ok: bool) {
        self.leg_usdc += self.account_value.max(0) as u64 * 100;
        self.account_value = 0;
        if send_ok {
            self.payout_usdc += self.leg_usdc;
            self.leg_usdc = 0;
        }
        self.advance();
    }

    fn advance(&mut self) {
        self.l1 += 20;
        self.ts += 5;
    }
}

fn sign(o: Result<Outcome, Error>) -> Order {
    match o {
        Ok(Outcome::Sign { order, .. }) => order,
        other => panic!("expected Sign, got {other:?}"),
    }
}

fn rescue_order(o: Result<Outcome, Error>) -> Order {
    match o {
        Ok(Outcome::Rescue { order: Some(p), .. }) => p.order,
        other => panic!("expected a rescue order, got {other:?}"),
    }
}

/// ADL cut the short from 1.0 to 0.6 ETH: under-hedged by 0.4.
fn broken() -> (Strategy, World) {
    let s = strategy(policy());
    let mut w = World::hedged();
    w.szi = -6 * ETH / 10;
    w.entry = 1_800_000_000;
    (s, w)
}

#[test]
fn healthy_hedge_cannot_be_farmed() {
    let mut s = strategy(policy());
    let mut w = World::hedged();
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::WithinTolerance));
    assert_eq!(s.pool, 10 * NEAR);
}

#[test]
fn plan_is_bounded_and_not_chosen_by_the_agent() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    let o = sign(s.open_repair(NOW, "agent.a", &p, &b));
    assert!(!o.is_buy && !o.reduce_only);
    assert_eq!(o.sz, 40_000_000, "exactly the 0.4 ETH gap");
    assert_eq!(o.limit_px, 2985 * 100_000_000, "oracle 3000 minus half the 1% band");
    assert_eq!(o.nonce, 0);
    assert_eq!(o.deadline, NOW + 60);
    assert_eq!(s.mode, Mode::Repairing);
    assert_eq!(s.pool, 9 * NEAR, "reward reserved");
}

#[test]
fn race_second_agent_is_refused() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    let (p2, b2) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.b", &p2, &b2), Err(Error::JobActive));
}

#[test]
fn repaired_pays_exactly_once() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(-4 * ETH / 10, 2_999_000_000);
    let (p2, b2) = (w.perp(), w.spot());
    match s.settle(NOW + 10, &p2, &b2) {
        Ok(Outcome::Repaired { payout, .. }) => {
            assert_eq!(payout.agent, "agent.a");
            assert_eq!(payout.amount, NEAR);
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(s.mode, Mode::Active);
    assert_eq!(s.payouts.len(), 1);

    // Claim again with the same evidence, with fresh evidence, or by reopening.
    assert_eq!(s.settle(NOW + 10, &p2, &b2), Err(Error::NoOpenJob));
    let (p3, b3) = (w.perp(), w.spot());
    assert_eq!(s.settle(NOW + 11, &p3, &b3), Err(Error::NoOpenJob));
    assert_eq!(s.open_repair(NOW + 11, "agent.a", &p2, &b2), Err(Error::EvidenceReused));
    assert_eq!(s.open_repair(NOW + 11, "agent.a", &p3, &b3), Err(Error::WithinTolerance));
    assert_eq!(s.payouts.len(), 1);
}

#[test]
fn submission_is_not_success() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));

    // Not relayed yet and deadline not passed: undecidable.
    w.ts += 5;
    let (p1, b1) = (w.perp(), w.spot());
    assert_eq!(s.settle(NOW + 5, &p1, &b1), Err(Error::AttemptNotResolved));

    // Relayed, but read before HyperCore had time to execute it.
    w.relay();
    w.l1 += 2;
    let (p2, b2) = (w.perp(), w.spot());
    assert_eq!(s.settle(NOW + 6, &p2, &b2), Err(Error::SnapshotNotSettled));
    assert_eq!(s.payouts.len(), 0);
}

#[test]
fn partial_fill_continues_then_pays_once() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(-ETH / 10, 2_999_000_000);
    let (p2, b2) = (w.perp(), w.spot());
    let o2 = sign(s.settle(NOW + 10, &p2, &b2));
    assert_eq!(o2.nonce, 1);
    assert_eq!(o2.sz, 30_000_000, "the remaining 0.3 ETH");
    assert_eq!(s.payouts.len(), 0);

    w.relay();
    w.fill(-3 * ETH / 10, 2_998_000_000);
    let (p3, b3) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 20, &p3, &b3), Ok(Outcome::Repaired { .. })));
    assert_eq!(s.payouts.len(), 1);
    assert_eq!(s.pool, 9 * NEAR);
}

#[test]
fn rejected_orders_exhaust_repair_and_unlock_flatten() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    let (pf, bf) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(NOW, "agent.f", &pf, &bf), Err(Error::FlattenNotTriggered));

    let mut out = None;
    for _ in 0..3 {
        w.relay();
        w.advance(); // executed, rejected by the exchange: no position change
        let (p2, b2) = (w.perp(), w.spot());
        out = Some(s.settle(w.ts, &p2, &b2));
    }
    assert!(matches!(out, Some(Ok(Outcome::Exhausted { .. }))), "{out:?}");
    assert_eq!(s.mode, Mode::RepairExhausted);
    assert_eq!(s.payouts.len(), 0);
    assert_eq!(s.pool, 10 * NEAR, "reservation released");

    let (p3, b3) = (w.perp(), w.spot());
    let o = rescue_order(s.open_flatten(w.ts, "agent.f", &p3, &b3));
    assert!(o.is_buy && o.reduce_only, "an exit only ever reduces");
}

#[test]
fn unrelayed_orders_do_not_count_as_failures() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    for i in 1..=5u64 {
        w.ts = NOW + 61 * i; // past each deadline, never relayed
        let (p2, b2) = (w.perp(), w.spot());
        let o = sign(s.settle(w.ts, &p2, &b2));
        assert_eq!(o.nonce, 0, "the same nonce is re-signed");
    }
    assert_eq!(s.mode, Mode::Repairing, "a griefer cannot force flatten by not relaying");
    w.ts = NOW + 3_700;
    let (p3, b3) = (w.perp(), w.spot());
    assert!(matches!(s.settle(w.ts, &p3, &b3), Ok(Outcome::Voided { ref reason, .. }) if reason == "job-expired"));
    assert_eq!(s.mode, Mode::Active);
}

#[test]
fn closing_both_legs_is_never_a_repair() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(0, 0);
    // Delta restored by selling 0.4 ETH of spot instead of growing the short.
    w.spot = 6 * WEI / 10;
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Voided { ref reason, .. }) if reason == "spot-leg-changed"));
    assert_eq!(s.payouts.len(), 0);

    // Both legs closed to zero: delta is 0 but it is still not a repair.
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.advance();
    w.spot = 0;
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Voided { .. })));
    assert_eq!(s.payouts.len(), 0);
}

#[test]
fn exchange_side_shrink_voids_instead_of_paying() {
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(2 * ETH / 10, 0); // liquidation/ADL shrank the short during the job
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Voided { ref reason, .. }) if reason == "position-changed-externally"));
}

#[test]
fn fill_beyond_order_or_limit_freezes() {
    // Grew the short by more than ordered: no signed order explains it.
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(-5 * ETH / 10, 2_999_000_000);
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Frozen { .. })));
    assert_eq!(s.mode, Mode::Frozen);
    let (p3, b3) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW + 20, "agent.a", &p3, &b3), Err(Error::Frozen));

    // Average fill price below the signed limit (2985).
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.fill(-4 * ETH / 10, 2_900_000_000);
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Frozen { ref reason }) if reason == "fill-below-limit"));
    assert_eq!(s.payouts.len(), 0);
}

#[test]
fn loss_budget_caps_size_and_blocks_jobs_it_cannot_afford() {
    // Worst case per ETH at 3000 with 1% band + 0.05% fee: 31.5 USD. A 6.3 USD budget allows 0.2 ETH.
    let mut p = policy();
    p.max_loss_usd6 = 6_300_000;
    let mut s = strategy(p);
    let mut w = World::hedged();
    w.szi = -6 * ETH / 10;
    let (pl, bl) = (w.perp(), w.spot());
    let o = sign(s.open_repair(NOW, "agent.a", &pl, &bl));
    assert_eq!(o.sz, 20_000_000);

    let mut p = policy();
    p.max_loss_usd6 = 100;
    let mut s = strategy(p);
    let (pl, bl) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &pl, &bl), Err(Error::LossBudgetExhausted));
}

#[test]
fn over_hedged_repair_buys_reduce_only() {
    let mut s = strategy(policy());
    let mut w = World::hedged();
    w.szi = -15 * ETH / 10;
    w.entry = 4_500_000_000;
    let (p, b) = (w.perp(), w.spot());
    let o = sign(s.open_repair(NOW, "agent.a", &p, &b));
    assert!(o.is_buy && o.reduce_only);
    assert_eq!(o.sz, 50_000_000);
    assert_eq!(o.limit_px, 3015 * 100_000_000);
    w.relay();
    w.fill(5 * ETH / 10, 0);
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(NOW + 10, &p2, &b2), Ok(Outcome::Repaired { .. })));
}

#[test]
fn signatures_the_judge_did_not_issue_stop_everything() {
    let (mut s, mut w) = broken();
    w.nonce = 2; // KeelLeg executed two signed actions this strategy never issued
    w.queued = w.l1;
    w.advance();
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::UnknownSignedAction));
}

#[test]
fn evidence_must_be_fresh_from_the_right_contracts() {
    let (mut s, mut w) = broken();
    w.ts = NOW - 500;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::StaleEvidence));

    w.ts = NOW;
    let mut p = w.perp();
    p.emitter = addr(0x99);
    let b = w.spot();
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::BadEvidence("emitter")));

    let mut p = w.perp();
    p.chain = Chain::Base;
    assert!(matches!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::BadEvidence(_))));

    let p = w.perp();
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &p.clone()), Err(Error::EvidenceReused));
}

#[test]
fn empty_pool_opens_nothing() {
    let c = strategy(policy()).config;
    let mut s = Strategy::new(c, NEAR / 2, NOW).unwrap();
    let mut w = World::hedged();
    w.szi = -6 * ETH / 10;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::RewardPoolEmpty));
}

#[test]
fn policy_tolerance_must_cover_a_lot() {
    let mut p = policy();
    p.tolerance = 9_999;
    let c = Config { policy: p, ..strategy(policy()).config };
    assert!(matches!(Strategy::new(c, NEAR, NOW), Err(Error::BadPolicy(_))));
}

#[test]
fn plans_around_mark_and_charges_the_basis() {
    // Oracle 3000, mark 2950: 1.67% basis, under the 2% cap. The limit sits half a band under the mark.
    let (mut s, mut w) = broken();
    w.mark_raw = 295_000;
    let (p, b) = (w.perp(), w.spot());
    let o = sign(s.open_repair(NOW, "agent.a", &p, &b));
    assert_eq!(o.limit_px, 293_530_000_000, "2950 x 0.995 = 2935.25, rounded up to 5 significant figures");
    assert_eq!(s.job.as_ref().unwrap().loss_used_usd6, 32_640_000, "0.4 ETH x 3000 x (100 + 5 + 167) bp = 32.64 USD");
}

#[test]
fn dislocated_market_plans_nothing() {
    let (mut s, mut w) = broken();
    w.mark_raw = 290_000; // 3.33% under the oracle
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &p, &b), Err(Error::MarketDislocated));

    // Mid-job: the attempt failed and the market then dislocated. The job ends unpaid, not frozen.
    let (mut s, mut w) = broken();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_repair(NOW, "agent.a", &p, &b));
    w.relay();
    w.advance();
    w.mark_raw = 290_000;
    let (p2, b2) = (w.perp(), w.spot());
    assert!(matches!(s.settle(w.ts, &p2, &b2), Ok(Outcome::Voided { ref reason, .. }) if reason == "market-dislocated"));
    assert_eq!(s.mode, Mode::Active);
}


#[test]
fn perp_snapshots_must_be_younger_than_spot_evidence() {
    let mut p = policy();
    p.max_evidence_age_s = 3_600;
    p.max_perp_age_s = 120;
    let mut s = strategy(p);
    let mut w = World::hedged();
    w.szi = -6 * ETH / 10;
    // A 20-minute-old snapshot (the Base wait) is refused for planning...
    w.ts = NOW - 1_200;
    let (pl, bl) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(NOW, "agent.a", &pl, &bl), Err(Error::StaleEvidence));
    // ...but 20-minute-old Base evidence with a fresh snapshot is fine.
    let bl = w.spot();
    w.ts = NOW;
    let pl = w.perp();
    assert!(matches!(s.open_repair(NOW, "agent.a", &pl, &bl), Ok(Outcome::Sign { .. })));
}

#[test]
fn v5_snapshots_still_decode_without_usdc_fields() {
    let mut w = World::hedged();
    let mut l = w.perp();
    l.topics[0] = Bytes(keccak(SNAPSHOT_SIG_V5.as_bytes()));
    l.data.drain(6 * 32..8 * 32);
    let s = keel_core::evidence::decode_snapshot(&l).unwrap();
    assert_eq!((s.spot_usdc, s.payout_usdc, s.l1_block, s.timestamp), (0, 0, 1_000, NOW));
}

// ---------- the mandate ----------

const AI: &str = "ai.testnet";
const GUARDIAN: &str = "guardian.testnet";

/// A directional mandate: no hedge rule, an AI manager capped at 1x, a 59 USD floor. Starting
/// liquidation value: 30 USD perp margin + 0.01 ETH at 3000 = 60 USD.
fn mandate_policy() -> Policy {
    let mut p = policy();
    p.hedge = false;
    p.max_leverage_bp = 10_000;
    p.equity_floor_usd6 = 59_000_000;
    p
}

fn mandate_with(p: Policy) -> (Strategy, World) {
    let mut c = config(p);
    c.manager = Some(AI.into());
    let s = Strategy::new(c, 10 * NEAR, NOW).unwrap();
    let mut w = World::hedged();
    w.szi = 0;
    w.entry = 0;
    w.spot = WEI / 100;
    (s, w)
}

fn mandate() -> (Strategy, World) {
    mandate_with(mandate_policy())
}

fn propose(s: &mut Strategy, w: &mut World, who: &str, is_buy: bool, sz: u64, px: u64) -> Result<Outcome, Error> {
    let (p, b) = (w.perp(), w.spot());
    s.propose(w.ts, who, &p, &b, is_buy, sz, px)
}

const PX: u64 = 100_000_000;

#[test]
fn only_the_manager_proposes_and_only_within_the_mandate() {
    let (mut s, mut w) = mandate();
    assert_eq!(propose(&mut s, &mut w, "someone.testnet", false, 1_000_000, 2985 * PX), Err(Error::Mandate("not-the-manager")));
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_000, 2900 * PX), Err(Error::Mandate("price-outside-band")));
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_001, 2985 * PX), Err(Error::Mandate("size")));

    // 0.01 ETH short = 30 USD notional against 60 USD: 0.5x.
    let o = sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    assert_eq!((o.nonce, o.sz, o.reduce_only), (0, 1_000_000, false));
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX), Err(Error::AttemptNotResolved));

    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    // 0.02 short is 60 USD against a liquidation value of 59.835 (closing the 0.01 short would cost
    // half the band plus the fee): just over 1x, refused.
    w.ts += 1;
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX), Err(Error::Mandate("leverage")));
    // Cutting exposure is always allowed, and is reduce-only.
    let o3 = sign(propose(&mut s, &mut w, AI, true, 1_000_000, 3015 * PX));
    assert!(o3.reduce_only);
}

#[test]
fn the_floor_uses_a_conservative_liquidation_value_across_both_chains() {
    let mut p = mandate_policy();
    p.spot_haircut_bp = 100;
    p.equity_floor_usd6 = 56_050_000;
    let (s, mut w) = mandate_with(p);
    w.szi = -ETH / 100;
    w.account_value = 25_000_000;
    w.leg_usdc = 200_000_000; // 2 USD of spot USDC still on the leg
    w.mark_raw = 295_000; // mark 2950 under an oracle of 3000
    let (pl, bl) = (w.perp(), w.spot());
    let (v, trigger) = s.valuation_of(w.ts, &pl, &bl).unwrap();
    assert_eq!(v.close_cost_usd6, 165_000, "0.01 ETH x 3000 (the higher price) x (50 + 5) bp");
    assert_eq!(v.spot_px_1e8, 2950 * PX, "spot valued at the lower of oracle and mark");
    assert_eq!(v.spot_value_usd6, 29_205_000, "0.01 ETH x 2950 less a 1% haircut");
    assert_eq!(v.leg_spot_usdc_usd6, 2_000_000);
    assert_eq!(v.total_usd6, 56_040_000, "25 + 2 - 0.165 + 29.205");
    assert!(v.below_floor);
    assert_eq!(trigger, Some(Trigger::Floor));
}

// ---------- the rescue ----------

fn rescue(o: Result<Outcome, Error>) -> Outcome {
    match o {
        Ok(r @ Outcome::Rescue { .. }) => r,
        other => panic!("expected a rescue step, got {other:?}"),
    }
}

/// The AI shorted 0.01 ETH and lost 5 USD: 25 + 30 - 0.165 = 54.835 USD, under the 59 USD floor.
fn breached() -> (Strategy, World) {
    let (mut s, mut w) = mandate();
    sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    w.account_value = 25_000_000;
    w.ts += 1;
    (s, w)
}

#[test]
fn below_the_floor_a_guardian_rescues_both_legs_and_each_leg_pays_once() {
    let (mut s, mut w) = mandate();
    sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    w.ts += 1;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(w.ts, GUARDIAN, &p, &b), Err(Error::FlattenNotTriggered), "above the floor nobody may exit");

    w.account_value = 25_000_000;
    assert_eq!(propose(&mut s, &mut w, AI, true, 1_000_000, 3015 * PX), Err(Error::Mandate("equity-below-floor")));
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(w.ts, AI, &p, &b), Err(Error::Mandate("manager-cannot-guard")));

    // The guardian opens: a reduce-only close on Hyperliquid and a vault exit on Base, together.
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { trigger, order, exit, sweep, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert_eq!(trigger, Trigger::Floor);
    let close = order.unwrap().order;
    assert!(close.is_buy && close.reduce_only && close.sz == 1_000_000 && close.nonce == 1);
    let exit = exit.unwrap();
    assert_eq!((exit.exit.nonce, exit.exit.token), (0, addr(TOKEN)));
    assert_eq!(exit.digest.0, exit_digest(84532, &addr(VAULT), &exit.exit), "KeelVault's own digest");
    assert!(sweep.is_none(), "no sweep while the position is open");
    assert_eq!(s.pool, 7 * NEAR, "both legs' rewards reserved");
    assert_eq!(propose(&mut s, &mut w, AI, true, 1_000_000, 3015 * PX), Err(Error::Mandate("strategy-not-active")));

    // The close fills: the next step is the sweep of every USDC on the leg to the payout.
    w.relay();
    w.fill(ETH / 100, 0);
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { sweep, exit, paid, perp, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    let sweep = sweep.unwrap();
    assert_eq!((sweep.sweep.nonce, sweep.sweep.usd_ntl, sweep.sweep.usdc_wei), (2, 25_000_000, 2_500_000_000));
    assert_eq!(sweep.digest.0, sweep_digest(998, &addr(LEG), &sweep.sweep));
    assert!(exit.is_none(), "the vault exit signed at open is still valid");
    assert!(paid.is_empty() && perp == LegStatus::Open, "a closed position is not a delivered leg");

    // The vault exit lands on Base: its receipt delivers the spot leg and pays that leg once.
    let r = w.exited(0, INVESTOR);
    let Outcome::Rescue { paid, spot, done, .. } = rescue(s.confirm_exit(w.ts, &r)) else { unreachable!() };
    assert_eq!((paid.len(), paid[0].amount, paid[0].agent.as_str(), paid[0].reason.as_str()), (1, NEAR, GUARDIAN, "spot"));
    assert!(spot == LegStatus::Delivered && !done);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::EvidenceReused));

    // The sweep is not relayed yet: undecidable. Then it runs and the payout shows the USDC.
    w.ts += 1;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.settle(w.ts, &p, &b), Err(Error::AttemptNotResolved));
    w.relay();
    w.sweep_runs(true);
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { paid, delivered, perp, done, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    assert_eq!((paid[0].amount, paid[0].reason.as_str()), (2 * NEAR, "perp"));
    assert_eq!(delivered[0].amount, 2_500_000_000);
    assert!(perp == LegStatus::Delivered && done);
    assert_eq!(s.mode, Mode::Flattened);
    assert_eq!(s.pool, 7 * NEAR);
    assert_eq!(s.payouts.len(), 2);
    assert_eq!(s.rescue.deliveries.len(), 2);

    // Nothing can be claimed twice.
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.settle(w.ts, &p, &b), Err(Error::NoOpenJob));
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(w.ts, GUARDIAN, &p, &b), Err(Error::Mandate("already-rescued")));
    w.spot = WEI / 100; // a second receipt for the same nonce, with a real amount
    let r2 = w.exited(0, INVESTOR);
    assert_eq!(s.confirm_exit(w.ts, &r2), Err(Error::UnknownSignedAction));
    assert_eq!(s.payouts.len(), 2);
}

#[test]
fn a_stuck_spot_asset_never_holds_back_the_usdc_and_a_new_guardian_takes_over() {
    let (mut s, mut w) = mandate();
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { trigger, sweep, exit, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert_eq!(trigger, Trigger::Investor, "the investor's request needs no floor breach");
    assert!(sweep.is_some() && exit.is_some(), "flat perp: sweep and vault exit at once");
    let first_deadline = exit.unwrap().exit.deadline;

    // The sweep delivers; the vault exit never lands (a frozen token reverts, spending nothing).
    w.relay();
    w.sweep_runs(true);
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { paid, perp, spot, exit, done, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    assert_eq!(paid[0].reason, "perp");
    assert!(perp == LegStatus::Delivered && spot == LegStatus::Open && !done);
    assert!(exit.is_none(), "the reading predates the exit's deadline: no new signature");

    // The guardian's job expires; its unpaid spot reward returns to the pool.
    w.ts = NOW + 3_700;
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { ended, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    assert_eq!(ended.as_deref(), Some("job-expired"));
    assert_eq!(s.pool, 8 * NEAR);
    assert_eq!(s.mode, Mode::Flattening, "the exit stays triggered");

    // Another guardian takes over: the same vault nonce is signed again, so at most one executes.
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { trigger, exit, sweep, order, .. } = rescue(s.open_flatten(w.ts, "guardian2.testnet", &p, &b)) else { unreachable!() };
    assert_eq!(trigger, Trigger::Investor);
    let exit = exit.unwrap().exit;
    assert!(exit.nonce == 0 && exit.deadline > first_deadline && sweep.is_none() && order.is_none());
    assert_eq!(s.pool, 7 * NEAR, "only the spot reward reserved now");
    let r = w.exited(0, INVESTOR);
    let Outcome::Rescue { paid, done, .. } = rescue(s.confirm_exit(w.ts, &r)) else { unreachable!() };
    assert_eq!(paid[0].agent, "guardian2.testnet");
    assert!(done);
}

#[test]
fn a_failed_sweep_is_retried_and_paid_only_on_arrival() {
    let (mut s, mut w) = mandate();
    w.spot = 0;
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { sweep, spot, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert_eq!(sweep.unwrap().sweep.usdc_wei, 3_000_000_000);
    assert_eq!(spot, LegStatus::Empty);
    assert_eq!(s.pool, 8 * NEAR, "no spot reward reserved for an empty vault");

    // The class transfer ran but the spot send failed: the USDC is still on the leg.
    w.relay();
    w.sweep_runs(false);
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { sweep, paid, perp, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    let retry = sweep.unwrap().sweep;
    assert_eq!((retry.nonce, retry.usd_ntl, retry.usdc_wei), (1, 0, 3_000_000_000), "only what is left, from spot");
    assert!(paid.is_empty() && perp == LegStatus::Open);
    assert_eq!(s.rescue.failed_sweeps, 1);

    w.relay();
    w.sweep_runs(true);
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { paid, done, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    assert_eq!(paid[0].amount, 2 * NEAR);
    assert!(done);
}

#[test]
fn a_leg_that_empties_without_arriving_pays_nothing() {
    // Liquidated before any sweep: the position and the margin are gone. Not a rescue.
    let (mut s, mut w) = breached();
    w.spot = 0;
    let (p, b) = (w.perp(), w.spot());
    rescue_order(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    w.szi = 0;
    w.account_value = 0;
    w.ts += 61; // the close was never relayed and has expired
    w.advance();
    let (p, b) = (w.perp(), w.spot());
    assert!(matches!(s.settle(w.ts, &p, &b), Ok(Outcome::Voided { ref reason, .. }) if reason == "position-changed-externally"));
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { perp, done, paid, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert!(perp == LegStatus::Empty && done && paid.is_empty());
    assert!(s.payouts.is_empty());

    // Swept, the leg emptied, but the payout never showed the USDC: unverified, no reward.
    let (mut s, mut w) = mandate();
    w.spot = 0;
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    w.relay();
    w.sweep_runs(true);
    w.payout_usdc -= 3_000_000_000; // gone before the evidence was read
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { perp, done, paid, .. } = rescue(s.settle(w.ts, &p, &b)) else { unreachable!() };
    assert!(perp == LegStatus::Unverified && done && paid.is_empty());
    assert_eq!(s.pool, 10 * NEAR, "every reserve returned");
}

#[test]
fn partial_closes_retry_within_bounds_then_hand_over() {
    let (mut s, mut w) = breached();
    w.spot = 0;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(rescue_order(s.open_flatten(w.ts, GUARDIAN, &p, &b)).sz, 1_000_000);
    let mut last = None;
    for i in 0..3 {
        w.relay();
        w.fill(ETH / 1_000, 0); // only 0.001 of the 0.01 fills each time
        let (p, b) = (w.perp(), w.spot());
        last = Some(rescue(s.settle(w.ts, &p, &b)));
        if let Some(Outcome::Rescue { order: Some(o), .. }) = &last {
            assert_eq!(o.order.sz, 1_000_000 - (i + 1) * 100_000, "the remaining position");
        }
    }
    let Some(Outcome::Rescue { ended, .. }) = last else { unreachable!() };
    assert_eq!(ended.as_deref(), Some("close-attempts"));
    assert!(s.job.is_none() && s.mode == Mode::Flattening);
    // A fresh guardian (or the same one) continues with a new job and a fresh attempt budget.
    w.ts += 1;
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(rescue_order(s.open_flatten(w.ts, "guardian2.testnet", &p, &b)).sz, 700_000);
}

#[test]
fn only_the_investor_requests_an_exit() {
    let (mut s, mut w) = mandate();
    assert_eq!(s.request_exit("stranger.testnet"), Err(Error::Mandate("not-the-investor")));
    assert_eq!(s.request_exit(AI), Err(Error::Mandate("not-the-investor")));
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(w.ts, GUARDIAN, &p, &b), Err(Error::FlattenNotTriggered));
    s.request_exit("investor.testnet").unwrap();
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX), Err(Error::Mandate("strategy-not-active")));
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { trigger, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert_eq!(trigger, Trigger::Investor);

    let mut c = config(mandate_policy());
    c.investor_account = None;
    let mut s = Strategy::new(c, NEAR, NOW).unwrap();
    assert_eq!(s.request_exit("investor.testnet"), Err(Error::Mandate("no-investor-account")));
}

#[test]
fn manager_silence_triggers_only_what_the_investor_chose() {
    // The investor chose nothing on silence: a silent manager is not, by itself, a reason to exit.
    let mut p = mandate_policy();
    p.heartbeat_s = 600;
    let (mut s, mut w) = mandate_with(p.clone());
    w.ts = NOW + 601;
    let (pl, bl) = (w.perp(), w.spot());
    assert!(s.silent(w.ts));
    assert_eq!(s.open_flatten(w.ts, GUARDIAN, &pl, &bl), Err(Error::FlattenNotTriggered));

    // The investor chose an exit on silence.
    p.on_silence = OnSilence::Exit;
    let (mut s, mut w) = mandate_with(p.clone());
    assert_eq!(s.heartbeat(NOW + 500, "stranger.testnet"), Err(Error::Mandate("not-the-manager")));
    s.heartbeat(NOW + 500, AI).unwrap();
    w.ts = NOW + 1_000;
    let (pl, bl) = (w.perp(), w.spot());
    assert_eq!(s.open_flatten(w.ts, GUARDIAN, &pl, &bl), Err(Error::FlattenNotTriggered), "heard from 500 s ago");
    w.ts = NOW + 1_101;
    assert_eq!(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX), Err(Error::Mandate("manager-silent")));
    let (pl, bl) = (w.perp(), w.spot());
    let Outcome::Rescue { trigger, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &pl, &bl)) else { unreachable!() };
    assert_eq!(trigger, Trigger::ManagerSilent);

    p.heartbeat_s = 0;
    assert!(matches!(Strategy::new(config(p), NEAR, NOW), Err(Error::BadPolicy("silence-needs-a-heartbeat"))));
}

#[test]
fn receipts_must_match_what_the_judge_signed() {
    let (mut s, mut w) = mandate();
    let r = w.exited(0, INVESTOR);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::Mandate("no-exit-signed")));

    let (mut s, mut w) = mandate();
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    let spot = w.spot;
    let receipt = |w: &mut World, nonce: u64, payout: u8| {
        w.spot = spot;
        w.exited(nonce, payout)
    };
    let r = receipt(&mut w, 0, 0x99);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::BadEvidence("exit-receipt")), "paid someone else");
    let mut r = receipt(&mut w, 0, INVESTOR);
    r.topics[2] = Bytes(enc_address(&addr(0x55).0));
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::BadEvidence("exit-receipt")), "another token");
    let mut r = receipt(&mut w, 0, INVESTOR);
    r.emitter = addr(0x45);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::BadEvidence("emitter")), "another vault");
    let mut r = receipt(&mut w, 0, INVESTOR);
    r.chain = Chain::HyperEvm;
    assert!(matches!(s.confirm_exit(w.ts, &r), Err(Error::BadEvidence(_))), "another chain");
    let r = receipt(&mut w, 1, INVESTOR);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::UnknownSignedAction), "a nonce the judge never signed");
    w.spot = 0;
    let r = w.exited(0, INVESTOR);
    assert_eq!(s.confirm_exit(w.ts, &r), Err(Error::BadEvidence("exit-receipt")), "nothing moved");
    assert!(s.payouts.is_empty());
    let r = receipt(&mut w, 0, INVESTOR);
    assert!(matches!(s.confirm_exit(w.ts, &r), Ok(Outcome::Rescue { .. })));
}

#[test]
fn refusals_change_nothing() {
    let (mut s, mut w) = breached();
    let (p, b) = (w.perp(), w.spot());
    rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    let before = serde_json::to_string(&s).unwrap();
    // A step that fails deep inside (the close is neither relayed nor expired) consumes nothing.
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.settle(w.ts, &p, &b), Err(Error::AttemptNotResolved));
    assert_eq!(s.open_flatten(w.ts, "guardian2.testnet", &p, &b), Err(Error::JobActive));
    assert_eq!(s.request_exit("stranger.testnet"), Err(Error::Mandate("not-the-investor")));
    assert_eq!(serde_json::to_string(&s).unwrap(), before);
}

#[test]
fn residual_funds_after_the_rescue_go_to_the_investor_without_reward() {
    let (mut s, mut w) = mandate();
    w.account_value = 0;
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    let r = w.exited(0, INVESTOR);
    let Outcome::Rescue { done, perp, .. } = rescue(s.confirm_exit(w.ts, &r)) else { unreachable!() };
    assert!(done && perp == LegStatus::Empty);
    let paid = s.payouts.len();

    // More tokens arrive after the rescue: anyone may send them on, for no reward.
    w.spot = WEI / 200;
    w.ts += 1;
    let (p, b) = (w.perp(), w.spot());
    match s.sweep(w.ts, &p, &b) {
        Ok(Outcome::Residual { exit: Some(x), sweep: None, .. }) => assert_eq!(x.exit.nonce, 1),
        other => panic!("{other:?}"),
    }
    let r = w.exited(1, INVESTOR);
    assert!(matches!(s.confirm_exit(w.ts, &r), Ok(Outcome::Residual { .. })));
    assert_eq!(s.payouts.len(), paid);
}

#[test]
fn a_directional_mandate_has_no_hedge_repair() {
    let (mut s, mut w) = mandate();
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_repair(w.ts, "agent.a", &p, &b), Err(Error::Mandate("no-hedge-rule")));
}

// ---------- v3.1: deleveraging, re-arming, funding ----------

/// A mandate with a deleverage rule: floor 40 USD, early warning at 55 USD, cut to 0.3x.
fn delever_mandate() -> (Strategy, World) {
    let mut p = mandate_policy();
    p.equity_floor_usd6 = 40_000_000;
    p.warn_usd6 = 55_000_000;
    p.delever_target_bp = 3_000;
    mandate_with(p)
}

/// The AI shorted 0.01 ETH and the account fell to 22 USD: 22 + 30 - 0.165 = 51.835, under the warning,
/// above the floor.
fn warned() -> (Strategy, World) {
    let (mut s, mut w) = delever_mandate();
    sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    w.account_value = 22_000_000;
    w.ts += 1;
    (s, w)
}

#[test]
fn an_early_warning_lets_anyone_cut_risk_to_the_target_and_pays_once() {
    let (mut s, mut w) = warned();
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_deleverage(w.ts, AI, &p, &b), Err(Error::Mandate("manager-cannot-guard")));
    let (p, b) = (w.perp(), w.spot());
    let o = sign(s.open_deleverage(w.ts, GUARDIAN, &p, &b));
    // Target: 0.3 x 51.835 USD = 15.55 USD at 3000 = 0.00518 ETH, rounded down to 0.0051.
    assert!(o.is_buy && o.reduce_only);
    assert_eq!(o.sz, 490_000, "from 0.01 down to the 0.0051 target");
    assert_eq!(s.mode, Mode::Deleveraging);
    assert_eq!(propose(&mut s, &mut w, AI, true, 100_000, 3015 * PX), Err(Error::Mandate("strategy-not-active")));

    w.relay();
    w.fill(49, 0);
    let (p, b) = (w.perp(), w.spot());
    match s.settle(w.ts, &p, &b) {
        Ok(Outcome::Repaired { payout, .. }) => assert_eq!((payout.agent.as_str(), payout.reason.as_str(), payout.amount), (GUARDIAN, "deleverage", NEAR / 2)),
        other => panic!("{other:?}"),
    }
    assert_eq!(s.mode, Mode::Active, "the manager may trade again, within its rules");
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.settle(w.ts, &p, &b), Err(Error::NoOpenJob));
}

#[test]
fn a_position_that_drifted_above_the_cap_can_be_cut_without_a_warning_level() {
    let mut p = mandate_policy();
    p.equity_floor_usd6 = 20_000_000;
    p.delever_target_bp = 5_000;
    let (mut s, mut w) = mandate_with(p);
    sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    // 30 + 30 - 0.165 = 59.8: a 30 USD short is 0.5x, within the 1x cap.
    w.ts += 1;
    let (pl, bl) = (w.perp(), w.spot());
    assert_eq!(s.open_deleverage(w.ts, GUARDIAN, &pl, &bl), Err(Error::Mandate("deleverage-not-due")));
    // No order since, but the value fell: 14 + 7.5 (a smaller spot leg) - 0.165 = 21.3, above the 20 USD
    // floor, and the same 30 USD short is now 1.4x.
    w.spot = WEI / 400;
    w.account_value = 14_000_000;
    w.ts += 1;
    let (pl, bl) = (w.perp(), w.spot());
    let o = sign(s.open_deleverage(w.ts, GUARDIAN, &pl, &bl));
    assert!(o.reduce_only && o.is_buy);
}

#[test]
fn below_the_floor_it_is_a_rescue_not_a_deleverage_and_healthy_strategies_are_left_alone() {
    let (mut s, mut w) = delever_mandate();
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_deleverage(w.ts, GUARDIAN, &p, &b), Err(Error::Mandate("deleverage-not-due")));

    let (mut s, mut w) = warned();
    w.account_value = 5_000_000; // 5 + 30 - 0.165 = 34.8 < 40: the floor broke
    let (p, b) = (w.perp(), w.spot());
    assert_eq!(s.open_deleverage(w.ts, GUARDIAN, &p, &b), Err(Error::Mandate("deleverage-not-due")));
    let (p, b) = (w.perp(), w.spot());
    assert!(matches!(s.open_flatten(w.ts, GUARDIAN, &p, &b), Ok(Outcome::Rescue { trigger: Trigger::Floor, .. })));
}

#[test]
fn a_partial_deleverage_continues_from_what_is_left() {
    let (mut s, mut w) = warned();
    let (p, b) = (w.perp(), w.spot());
    sign(s.open_deleverage(w.ts, GUARDIAN, &p, &b));
    w.relay();
    w.fill(20, 0); // 0.002 of the 0.0049 filled
    let (p, b) = (w.perp(), w.spot());
    let next = sign(s.settle(w.ts, &p, &b));
    assert_eq!(next.sz, 290_000, "the remaining excess over the target");
    assert_eq!(s.payouts.len(), 0);
}

#[test]
fn a_warning_level_needs_a_target_above_the_floor() {
    let mut p = mandate_policy();
    p.warn_usd6 = 50_000_000;
    assert!(matches!(Strategy::new(config(p.clone()), NEAR, NOW), Err(Error::BadPolicy(_))), "no target");
    p.delever_target_bp = 3_000;
    p.warn_usd6 = p.equity_floor_usd6;
    assert!(matches!(Strategy::new(config(p), NEAR, NOW), Err(Error::BadPolicy(_))), "warning at the floor");
}

#[test]
fn the_investor_rearms_a_rescued_strategy_and_its_history_and_nonces_carry_on() {
    let (mut s, mut w) = mandate();
    w.account_value = 0;
    assert_eq!(s.rearm(w.ts, "investor.testnet"), Err(Error::Mandate("rearm-only-after-a-rescue")));
    s.request_exit("investor.testnet").unwrap();
    let (p, b) = (w.perp(), w.spot());
    rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b));
    let r = w.exited(0, INVESTOR);
    let Outcome::Rescue { done, .. } = rescue(s.confirm_exit(w.ts + 7, &r)) else { unreachable!() };
    assert!(done);
    assert_eq!((s.rescue.deliveries[0].at, s.rescue.deliveries[0].cycle), (w.ts + 7, 0));

    assert_eq!(s.rearm(w.ts + 10, "stranger.testnet"), Err(Error::Mandate("not-the-investor")));
    assert_eq!(s.rearm(w.ts + 10, AI), Err(Error::Mandate("not-the-investor")));
    s.rearm(w.ts + 10, "investor.testnet").unwrap();
    assert_eq!((s.mode, s.cycle, s.rescue.vault_nonce, s.rescue.deliveries.len()), (Mode::Active, 1, 1, 1));
    assert_eq!(s.last_heartbeat, w.ts + 10);

    // Funded again, the manager trades; a second exit signs the vault's next nonce.
    w.spot = WEI / 100;
    w.account_value = 30_000_000;
    w.ts += 20;
    sign(propose(&mut s, &mut w, AI, false, 1_000_000, 2985 * PX));
    w.relay();
    w.fill(-ETH / 100, 2_999_000_000);
    s.request_exit("investor.testnet").unwrap();
    w.ts += 1;
    let (p, b) = (w.perp(), w.spot());
    let Outcome::Rescue { exit, .. } = rescue(s.open_flatten(w.ts, GUARDIAN, &p, &b)) else { unreachable!() };
    assert_eq!(exit.unwrap().exit.nonce, 1);
}

#[test]
fn anyone_can_top_up_the_reward_pool() {
    let (mut s, _) = mandate();
    let before = s.pool;
    s.fund(3 * NEAR).unwrap();
    assert_eq!(s.pool, before + 3 * NEAR);
    assert!(s.fund(u128::MAX).is_err());
    assert_eq!(s.pool, before + 3 * NEAR, "a refused top-up changes nothing");
}
