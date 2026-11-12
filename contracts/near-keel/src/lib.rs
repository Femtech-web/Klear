//! Keel judge on NEAR: an investor's mandate for a manager (an AI agent or a person) and a
//! manager-proof rescue.
//!
//! Evidence comes in only through NEAR's Read MPC: `attest` states a HyperEVM or Base log, binds
//! the MPC request to it with `expected_payload_hash`, and stores the log only if the network
//! confirms exactly that log at `Finalized`. Jobs are opened and settled by keel-core's rules
//! over stored evidence. Actions leave only as MPC signatures for this account's derived keys (the
//! KeelLeg controller and the KeelVault controller), and rewards leave only as transfers of the
//! payouts keel-core recorded in this call, each once.
//!
//! The account is meant to be locked (no access keys) after deployment: then no one, including the
//! deployer, can change the code, the mandate or the payout addresses.

use keel_core::engine::{ExitPlan, Outcome, Strategy, SweepPlan};
use keel_core::evidence::{Chain, Log};
use keel_core::readmpc::{self, EvmLog};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

/// Both `sign` and `verify_foreign_transaction` require at least 15 Tgas attached.
const MPC_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct KeelJudge {
    owner: AccountId,
    mpc: AccountId,
    /// Derivation path of the KeelLeg controller key, e.g. "keel/1/hyperevm".
    sign_path: String,
    /// Derivation path of the spot account's key (the exit's spot-chain transaction).
    spot_path: String,
    sign_domain: u64,
    foreign_tx_domain: u64,
    /// keel-core's `Strategy`, as JSON.
    strategy: String,
    /// "chain:tx:log_index" -> keel-core `Log` JSON, for logs the MPC network confirmed.
    attested: LookupMap<String, String>,
    /// "job:nonce" -> the order, its digest and the controller's (v, r, s), for relayers.
    signatures: LookupMap<String, String>,
    /// Who asked for each attestation: only they may open a job on it, so nobody can take another
    /// guardian's evidence (and reward) by racing their `open_*` call.
    attesters: LookupMap<String, AccountId>,
}

enum Act {
    Open,
    Flatten,
    Deleverage,
    Settle,
    Propose { is_buy: bool, sz: u64, limit_px: u64 },
    Sweep,
}

/// The number of payouts before a call, so the call pays exactly the ones it added.
type Paid = usize;

fn chain_of(name: &str) -> Chain {
    match name {
        "hyperevm" => Chain::HyperEvm,
        "base" => Chain::Base,
        _ => env::panic_str("chain must be hyperevm or base"),
    }
}

fn now() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn key_of(l: &Log) -> String {
    let chain = if l.chain == Chain::HyperEvm { "hyperevm" } else { "base" };
    format!("{chain}:{}:{}", l.tx.hex(), l.log_index)
}

#[near]
impl KeelJudge {
    /// The attached deposit is the reward pool.
    #[init]
    #[payable]
    pub fn new(
        owner: AccountId,
        mpc: AccountId,
        sign_path: String,
        sign_domain: u64,
        foreign_tx_domain: u64,
        config: Value,
        spot_path: Option<String>,
    ) -> Self {
        let config = serde_json::from_value(config).unwrap_or_else(|e| env::panic_str(&format!("config: {e}")));
        let strategy = Strategy::new(config, env::attached_deposit().as_yoctonear(), now())
            .unwrap_or_else(|e| env::panic_str(&e.code()));
        Self {
            owner,
            mpc,
            sign_path,
            spot_path: spot_path.unwrap_or_else(|| "keel/1/spot".into()),
            sign_domain,
            foreign_tx_domain,
            strategy: serde_json::to_string(&strategy).unwrap(),
            attested: LookupMap::new(b"a"),
            signatures: LookupMap::new(b"s"),
            attesters: LookupMap::new(b"w"),
        }
    }

    // ---------- evidence ----------

    /// Anyone: ask Read MPC to confirm `log` (an `eth_getTransactionReceipt` log object) on `chain`.
    #[payable]
    pub fn attest(&mut self, chain: String, log: Value) -> Promise {
        require!(env::attached_deposit() >= NearToken::from_yoctonear(1), "attach 1 yoctoNEAR");
        let chain = chain_of(&chain);
        let evm = EvmLog::from_rpc(&log).unwrap_or_else(|e| env::panic_str(&e));
        let evidence = evm.to_evidence(chain).unwrap_or_else(|e| env::panic_str(&e));
        let key = key_of(&evidence);
        require!(!self.attested.contains_key(&key), "already attested");
        let (expected, args) = readmpc::log_request(chain, &evm, self.foreign_tx_domain);
        Promise::new(self.mpc.clone())
            .function_call("verify_foreign_transaction", args.to_string().into_bytes(), NearToken::from_yoctonear(1), MPC_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_attested(
                key,
                serde_json::to_string(&evidence).unwrap(),
                hex::encode(expected),
                env::predecessor_account_id(),
            ))
    }

    #[private]
    pub fn on_attested(
        &mut self,
        key: String,
        evidence: String,
        expected: String,
        by: AccountId,
        #[callback_result] result: Result<Value, PromiseError>,
    ) -> bool {
        match result {
            Ok(v) if v["payload_hash"].as_str() == Some(expected.as_str()) && !self.attested.contains_key(&key) => {
                log!("attested {} for {}", key, by);
                self.attested.insert(key.clone(), evidence);
                self.attesters.insert(key, by);
                true
            }
            _ => {
                log!("not attested {}", key);
                false
            }
        }
    }

    // ---------- jobs ----------

    /// Any agent: open a repair job on evidence it attested. The caller is the job's agent.
    pub fn open_repair(&mut self, perp: String, spot: String) -> Value {
        self.require_attester(&perp);
        self.act(Act::Open, perp, spot)
    }

    /// Any agent but the manager, once an exit is triggered: open (or take over) the rescue on
    /// evidence it attested.
    pub fn open_flatten(&mut self, perp: String, spot: String) -> Value {
        self.require_attester(&perp);
        self.act(Act::Flatten, perp, spot)
    }

    /// Any agent but the manager, once the investor's early warning or a leverage drift is attested: cut the
    /// position back to the investor's target, on evidence it attested.
    pub fn open_deleverage(&mut self, perp: String, spot: String) -> Value {
        self.require_attester(&perp);
        self.act(Act::Deleverage, perp, spot)
    }

    /// Anyone: the next step of the open job on attested evidence; pays its agent on success.
    pub fn settle(&mut self, perp: String, spot: String) -> Value {
        self.act(Act::Settle, perp, spot)
    }

    /// Anyone: an attested KeelVault `Exited` receipt for the exit this judge signed.
    pub fn confirm_exit(&mut self, receipt: String) -> Value {
        let mut s = self.load();
        let paid = s.payouts.len();
        let r = s.confirm_exit(now(), &self.evidence(&receipt));
        self.commit(s, r, paid)
    }

    /// The mandate's manager only: one order, signed only if it fits the mandate on attested state.
    pub fn propose_order(&mut self, perp: String, spot: String, is_buy: bool, sz: u64, limit_px: u64) -> Value {
        self.act(Act::Propose { is_buy, sz, limit_px }, perp, spot)
    }

    /// The mandate's manager only: a sign of life.
    pub fn heartbeat(&mut self) {
        let mut s = self.load();
        s.heartbeat(now(), env::predecessor_account_id().as_str()).unwrap_or_else(|e| env::panic_str(&e.code()));
        self.strategy = serde_json::to_string(&s).unwrap();
    }

    /// The investor's NEAR account only: trigger the rescue, at any time.
    pub fn request_exit(&mut self) {
        let mut s = self.load();
        s.request_exit(env::predecessor_account_id().as_str()).unwrap_or_else(|e| env::panic_str(&e.code()));
        log!("exit requested by the investor");
        self.strategy = serde_json::to_string(&s).unwrap();
    }

    /// The investor's NEAR account, after a completed rescue: start the strategy again on the same accounts.
    pub fn rearm(&mut self) {
        let mut s = self.load();
        s.rearm(now(), env::predecessor_account_id().as_str()).unwrap_or_else(|e| env::panic_str(&e.code()));
        log!("re-armed: cycle {}", s.cycle);
        self.strategy = serde_json::to_string(&s).unwrap();
    }

    /// Anyone: add the attached deposit to the reward pool.
    #[payable]
    pub fn fund_pool(&mut self) {
        let mut s = self.load();
        s.fund(env::attached_deposit().as_yoctonear()).unwrap_or_else(|e| env::panic_str(&e.code()));
        self.strategy = serde_json::to_string(&s).unwrap();
    }

    /// Anyone, after the rescue: anything left on either leg to the investor. No reward.
    pub fn sweep(&mut self, perp: String, spot: String) -> Value {
        self.act(Act::Sweep, perp, spot)
    }

    fn require_attester(&self, perp: &str) {
        let by = self.attesters.get(perp).unwrap_or_else(|| env::panic_str(&format!("not attested: {perp}")));
        require!(by == &env::predecessor_account_id(), "only the account that attested this evidence may open a job on it");
    }

    fn act(&mut self, act: Act, perp: String, spot: String) -> Value {
        let mut s = self.load();
        let (perp, spot) = (self.evidence(&perp), self.evidence(&spot));
        let now = now();
        let caller = env::predecessor_account_id();
        let paid = s.payouts.len();
        let r = match act {
            Act::Open => s.open_repair(now, caller.as_str(), &perp, &spot),
            Act::Flatten => s.open_flatten(now, caller.as_str(), &perp, &spot),
            Act::Deleverage => s.open_deleverage(now, caller.as_str(), &perp, &spot),
            Act::Settle => s.settle(now, &perp, &spot),
            Act::Propose { is_buy, sz, limit_px } => s.propose(now, caller.as_str(), &perp, &spot, is_buy, sz, limit_px),
            Act::Sweep => s.sweep(now, &perp, &spot),
        };
        self.commit(s, r, paid)
    }

    /// Keep the new state, ask the MPC for every signature the outcome needs, and pay exactly the
    /// payouts keel-core added during this call. A refusal changes nothing: the transaction fails
    /// with keel-core's code.
    fn commit(&mut self, s: Strategy, r: Result<Outcome, keel_core::Error>, paid: Paid) -> Value {
        let out = r.unwrap_or_else(|e| env::panic_str(&e.code()));
        for p in &s.payouts[paid..] {
            let to: AccountId = p.agent.parse().unwrap_or_else(|_| env::panic_str("agent"));
            Promise::new(to).transfer(NearToken::from_yoctonear(p.amount)).detach();
        }
        self.strategy = serde_json::to_string(&s).unwrap();
        match &out {
            Outcome::Sign { job_id, order, digest } => self.sign_order(*job_id, order, digest),
            Outcome::Rescue { job_id, order, sweep, exit, .. } => {
                if let Some(o) = order {
                    self.sign_order(*job_id, &o.order, &o.digest);
                }
                self.sign_rest(sweep.as_ref(), exit.as_ref());
            }
            Outcome::Residual { sweep, exit, .. } => self.sign_rest(sweep.as_ref(), exit.as_ref()),
            _ => {}
        }
        let v = serde_json::to_value(&out).unwrap();
        log!("{}", v);
        v
    }

    fn sign_order(&self, job_id: u64, order: &keel_core::eip712::Order, digest: &keel_core::B32) {
        self.request_signature(self.sign_path.clone(), &digest.0, format!("{job_id}:{}", order.nonce), json!({ "order": order }));
    }

    fn sign_rest(&self, sweep: Option<&SweepPlan>, exit: Option<&ExitPlan>) {
        if let Some(w) = sweep {
            self.request_signature(self.sign_path.clone(), &w.digest.0, format!("sweep:{}", w.sweep.nonce), json!({ "sweep": w.sweep }));
        }
        if let Some(x) = exit {
            self.request_signature(self.spot_path.clone(), &x.digest.0, format!("exit:{}", x.exit.nonce), json!({ "exit": x.exit }));
        }
    }

    /// Ask the MPC to sign `digest` with this account's key for `path`; the signature is stored under
    /// `key` with `record`, for anyone to relay.
    fn request_signature(&self, path: String, digest: &[u8; 32], key: String, record: Value) {
        Promise::new(self.mpc.clone())
            .function_call(
                "sign",
                keel_core::mpc::sign_args(&path, digest, self.sign_domain).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                MPC_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(key, record, hex::encode(digest)))
            .detach();
    }

    #[private]
    pub fn on_signed(&mut self, key: String, record: Value, digest: String, #[callback_result] result: Result<Value, PromiseError>) -> bool {
        let Ok(resp) = result else {
            log!("sign failed for {}", key);
            return false;
        };
        let Ok((v, r, s)) = keel_core::mpc::vrs(&resp) else {
            log!("unexpected signature for {}", key);
            return false;
        };
        let mut record = record;
        record["digest"] = json!(format!("0x{digest}"));
        record["v"] = json!(v);
        record["r"] = json!(format!("0x{}", hex::encode(r)));
        record["s"] = json!(format!("0x{}", hex::encode(s)));
        log!("signed {}", key);
        self.signatures.insert(key, record.to_string());
        true
    }

    // ---------- views ----------

    pub fn get_strategy(&self) -> Value {
        serde_json::from_str(&self.strategy).unwrap()
    }

    /// The liquidation value on two attested logs and what exit (if any) it triggers now; the
    /// numbers guardians, the manager and the investor all act on.
    pub fn valuation(&self, perp: String, spot: String) -> Value {
        let (v, trigger) = self
            .load()
            .valuation_of(now(), &self.evidence(&perp), &self.evidence(&spot))
            .unwrap_or_else(|e| env::panic_str(&e.code()));
        json!({ "valuation": v, "trigger": trigger, "silent": self.load().silent(now()) })
    }

    /// At a glance, without evidence: what guardians and the registry's readers scan. Floor breaches need
    /// attested evidence (`valuation`); everything here is the judge's own state and clock.
    pub fn status(&self) -> Value {
        let s = self.load();
        let p = &s.config.policy;
        json!({
            "mode": s.mode,
            "exit_requested": s.exit_requested,
            "silent": s.silent(now()),
            "exit_on_silence": p.on_silence == keel_core::engine::OnSilence::Exit,
            "last_heartbeat": s.last_heartbeat,
            "heartbeat_s": p.heartbeat_s,
            "trigger": s.rescue.trigger,
            "perp": s.rescue.perp,
            "spot": s.rescue.spot,
            "cycle": s.cycle,
            "pool": s.pool.to_string(),
            "job": s.job.as_ref().map(|j| json!({"id": j.id, "kind": j.kind, "agent": j.agent, "expires_at": j.expires_at})),
            "manager": s.config.manager,
            "investor": s.config.investor,
            "investor_account": s.config.investor_account,
            "floor_usd6": p.equity_floor_usd6,
            "warn_usd6": p.warn_usd6,
        })
    }

    pub fn get_attester(&self, key: String) -> Option<AccountId> {
        self.attesters.get(&key).cloned()
    }

    pub fn get_attested(&self, key: String) -> Option<Value> {
        self.attested.get(&key).map(|e| serde_json::from_str(e).unwrap())
    }

    pub fn get_signature(&self, job_id: u64, nonce: u64) -> Option<Value> {
        self.get_record(format!("{job_id}:{nonce}"))
    }

    /// "job:nonce" for orders (job 0 = the manager's), "sweep:n" for KeelLeg sweeps, "exit:n" for
    /// KeelVault exits (n = the vault's nonce; a re-signed exit replaces the record).
    pub fn get_record(&self, key: String) -> Option<Value> {
        self.signatures.get(&key).map(|e| serde_json::from_str(e).unwrap())
    }

    pub fn get_config(&self) -> Value {
        json!({
            "owner": self.owner,
            "mpc": self.mpc,
            "sign_path": self.sign_path,
            "spot_path": self.spot_path,
            "sign_domain": self.sign_domain,
            "foreign_tx_domain": self.foreign_tx_domain,
        })
    }

    fn load(&self) -> Strategy {
        serde_json::from_str(&self.strategy).unwrap()
    }

    fn evidence(&self, key: &str) -> Log {
        let raw = self.attested.get(key).unwrap_or_else(|| env::panic_str(&format!("not attested: {key}")));
        serde_json::from_str(raw).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, PromiseResult};

    const PERP_KEY: &str = "hyperevm:0x0101010101010101010101010101010101010101010101010101010101010101:0";

    fn policy() -> Value {
        json!({"perp":4,"sz_decimals":4,"band_bp":100,"max_basis_bp":500,"fee_bp":5,"max_order_sz":1000000,
            "tolerance":100000,"max_loss_usd6":2000000,"settle_delay_l1":300,"max_evidence_age_s":900,"order_ttl_s":300,
            "job_ttl_s":7200,"max_failed_attempts":3,"dust":10000,
            "repair_reward":"500000000000000000000000","flatten_reward":"500000000000000000000000"})
    }

    /// A hedge-only strategy (no investor, no manager).
    fn config() -> Value {
        json!({"strategy_id":1,"chain_id":998,"leg":"0x1111111111111111111111111111111111111111",
          "spot_account":"0x2222222222222222222222222222222222222222","spot_token":"0x3333333333333333333333333333333333333333",
          "probe":"0x4444444444444444444444444444444444444444","spot_chain":"hyperevm","policy":policy()})
    }

    /// A mandate: an AI manager, the investor's NEAR account and payout, the spot leg in a vault.
    fn mandate() -> Value {
        json!({"strategy_id":2,"chain_id":998,"leg":"0x1111111111111111111111111111111111111111",
          "spot_account":"0x4444444444444444444444444444444444444444","spot_token":"0x3333333333333333333333333333333333333333",
          "probe":"0x4444444444444444444444444444444444444444","spot_chain":"base","spot_chain_id":84532,
          "manager":"ai.testnet","investor":"0x7777777777777777777777777777777777777777",
          "investor_account":"investor.testnet","policy":policy()})
    }

    fn as_account(who: &str) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(who.parse().unwrap());
        testing_env!(ctx.build());
    }

    fn judge_with(config: Value) -> KeelJudge {
        let mut ctx = VMContextBuilder::new();
        ctx.attached_deposit(NearToken::from_near(1));
        testing_env!(ctx.build());
        KeelJudge::new("owner.testnet".parse().unwrap(), "v1.signer-prod.testnet".parse().unwrap(), "keel/1/hyperevm".into(), 0, 3, config, None)
    }

    fn judge() -> KeelJudge {
        judge_with(config())
    }

    #[test]
    fn status_reads_the_judge_without_evidence() {
        let j = judge_with(mandate());
        let st = j.status();
        assert_eq!(st["mode"], "active");
        assert_eq!(st["exit_requested"], false);
        assert_eq!(st["manager"], "ai.testnet");
        assert_eq!(st["investor_account"], "investor.testnet");
    }

    #[test]
    fn init_deposit_is_the_reward_pool() {
        let j = judge();
        let s = j.get_strategy();
        assert_eq!(s["mode"], "active");
        assert_eq!(s["pool"], "1000000000000000000000000");
        assert_eq!(j.get_config()["sign_path"], "keel/1/hyperevm");
    }

    #[test]
    #[should_panic(expected = "not attested")]
    fn jobs_use_only_attested_evidence() {
        let mut j = judge();
        j.open_repair("hyperevm:0x01:0".into(), "hyperevm:0x02:0".into());
    }

    #[test]
    #[should_panic(expected = "only the account that attested this evidence may open a job on it")]
    fn nobody_can_open_a_job_on_another_guardians_evidence() {
        let mut j = judge_with(mandate());
        j.attesters.insert(PERP_KEY.into(), "guardian.testnet".parse().unwrap());
        as_account("thief.testnet");
        j.open_flatten(PERP_KEY.into(), PERP_KEY.into());
    }

    /// The MPC's answer to `verify_foreign_transaction` (None = the call failed), fed to the callback.
    fn mpc_says(j: &mut KeelJudge, answer: Option<&str>, expected: &str) -> bool {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("judge.testnet".parse().unwrap()).current_account_id("judge.testnet".parse().unwrap());
        let body = answer.map(|h| json!({ "payload_hash": h, "signature": {} }));
        let result = match &body {
            Some(b) => PromiseResult::Successful(b.to_string().into_bytes()),
            None => PromiseResult::Failed,
        };
        testing_env!(ctx.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
        j.on_attested(PERP_KEY.into(), "{}".into(), expected.into(), "guardian.testnet".parse().unwrap(), body.ok_or(PromiseError::Failed))
    }

    #[test]
    fn only_a_matching_mpc_answer_stores_evidence_and_only_once() {
        let mut j = judge();
        let ok = Some;
        assert!(!mpc_says(&mut j, None, "aa"), "MPC refused");
        assert!(!mpc_says(&mut j, ok("bb"), "aa"), "the MPC confirmed some other payload");
        assert!(j.get_attested(PERP_KEY.into()).is_none());
        assert!(mpc_says(&mut j, ok("aa"), "aa"));
        assert_eq!(j.get_attester(PERP_KEY.into()).unwrap().as_str(), "guardian.testnet");
        assert!(!mpc_says(&mut j, ok("aa"), "aa"), "a second attestation never replaces the first");
    }

    #[test]
    #[should_panic(expected = "mandate:not-the-investor")]
    fn only_the_investor_requests_an_exit() {
        let mut j = judge_with(mandate());
        as_account("investor.testnet");
        j.request_exit();
        assert_eq!(j.get_strategy()["exit_requested"], true);
        as_account("owner.testnet"); // not even the deployer
        j.request_exit();
    }

    #[test]
    #[should_panic(expected = "mandate:not-the-manager")]
    fn only_the_manager_sends_heartbeats() {
        let mut j = judge_with(mandate());
        as_account("ai.testnet");
        j.heartbeat();
        as_account("guardian.testnet");
        j.heartbeat();
    }

    #[test]
    #[should_panic(expected = "mandate:rearm-only-after-a-rescue")]
    fn only_the_investor_rearms_and_only_after_a_rescue() {
        let mut j = judge_with(mandate());
        as_account("investor.testnet");
        j.rearm();
    }

    #[test]
    #[should_panic(expected = "mandate:not-the-investor")]
    fn nobody_else_can_rearm() {
        let mut j = judge_with(mandate());
        as_account("guardian.testnet");
        j.rearm();
    }

    #[test]
    fn anyone_tops_up_the_reward_pool() {
        let mut j = judge_with(mandate());
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("friend.testnet".parse().unwrap()).attached_deposit(NearToken::from_near(2));
        testing_env!(ctx.build());
        j.fund_pool();
        assert_eq!(j.get_strategy()["pool"], "3000000000000000000000000");
    }

    #[test]
    #[should_panic(expected = "only the account that attested this evidence may open a job on it")]
    fn nobody_can_open_a_deleverage_on_another_guardians_evidence() {
        let mut j = judge_with(mandate());
        j.attesters.insert(PERP_KEY.into(), "guardian.testnet".parse().unwrap());
        as_account("thief.testnet");
        j.open_deleverage(PERP_KEY.into(), PERP_KEY.into());
    }

    #[test]
    #[should_panic(expected = "bad-policy:spot-leg-must-be-a-vault")]
    fn an_exit_to_the_investor_needs_the_spot_leg_in_a_vault() {
        let mut c = mandate();
        c["probe"] = json!("0x2222222222222222222222222222222222222222");
        judge_with(c);
    }

    #[test]
    #[should_panic(expected = "chain must be hyperevm or base")]
    fn attest_rejects_unknown_chains() {
        let mut j = judge();
        let mut ctx = VMContextBuilder::new();
        ctx.attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        j.attest("ethereum".into(), json!({})).detach();
    }
}
