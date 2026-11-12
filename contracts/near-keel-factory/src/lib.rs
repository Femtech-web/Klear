//! Keel's factory on NEAR: anyone creates a strategy's judge here, and the factory keeps the public registry
//! of every strategy, which is how guardians and the site discover them.
//!
//! A judge is created as `<name>.<factory>` in one batch: create the account, fund its storage, deploy the
//! judge's code (embedded at build time; `judge_code_hash` publishes its sha256), and initialize it with the
//! investor's mandate, everything attached beyond storage becoming its reward pool. No access key is ever
//! added, so the judge is locked from birth: nobody, including its creator and this factory, can change its
//! code or its mandate. If any step fails the whole batch is undone and the creator is refunded.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::Vector;
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

/// The judge this factory deploys (contracts/near-keel, built first).
const JUDGE_WASM: &[u8] = include_bytes!("../../near-keel/target/near/near_keel.wasm");
/// Bytes reserved for the judge's state beyond its code (its strategy JSON, evidence and signature records).
const STATE_BYTES: u128 = 40_000;
/// A reward pool smaller than this cannot pay a guardian anything worth the gas.
const MIN_POOL: NearToken = NearToken::from_millinear(100);
const INIT_GAS: Gas = Gas::from_tgas(60);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Entry {
    pub judge: AccountId,
    pub creator: AccountId,
    pub investor_account: Option<String>,
    pub label: String,
    /// NEAR block seconds.
    pub created_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct KeelFactory {
    mpc: AccountId,
    sign_domain: u64,
    foreign_tx_domain: u64,
    strategies: Vector<Entry>,
}

/// `name` becomes `<name>.<factory>`: 2 to 32 of `a-z 0-9 - _`, starting with a letter or digit.
fn valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

#[near]
impl KeelFactory {
    #[init]
    pub fn new(mpc: AccountId, sign_domain: u64, foreign_tx_domain: u64) -> Self {
        Self { mpc, sign_domain, foreign_tx_domain, strategies: Vector::new(b"s") }
    }

    /// Storage for a judge's code and state. A creation must attach this plus at least `MIN_POOL`.
    pub fn creation_cost(&self) -> NearToken {
        NearToken::from_yoctonear((JUDGE_WASM.len() as u128 + STATE_BYTES) * env::storage_byte_cost().as_yoctonear())
    }

    /// sha256 of the judge code every strategy here runs: compare with `view_code` on any judge.
    pub fn judge_code_hash(&self) -> String {
        hex::encode(env::sha256(JUDGE_WASM))
    }

    /// Anyone: create a strategy's judge, locked from birth, with `config` as its mandate (keel-core's
    /// `Config`: the KeelLeg and KeelVault addresses, the investor, the manager, the policy). The deposit
    /// beyond `creation_cost` is the reward pool.
    #[payable]
    pub fn create_strategy(&mut self, name: String, config: Value, label: String) -> Promise {
        require!(valid_name(&name), "name: 2-32 of a-z 0-9 - _");
        require!(label.len() <= 80, "label: at most 80 characters");
        require!(config["investor"].is_string() && config["investor_account"].is_string(), "config needs the investor's payout address and NEAR account");
        let deposit = env::attached_deposit();
        let cost = self.creation_cost();
        require!(deposit >= cost.saturating_add(MIN_POOL), "attach the creation cost plus a reward pool of at least 0.1 NEAR");
        let judge: AccountId = format!("{name}.{}", env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("name"));
        let investor_account = config["investor_account"].as_str().map(String::from);
        let owner = investor_account.clone().unwrap_or_else(|| env::predecessor_account_id().to_string());
        let args = json!({
            "owner": owner,
            "mpc": self.mpc,
            "sign_path": "keel/1/hyperevm",
            "sign_domain": self.sign_domain,
            "foreign_tx_domain": self.foreign_tx_domain,
            "config": config,
            "spot_path": "keel/1/spot",
        });
        Promise::new(judge.clone())
            .create_account()
            .transfer(cost)
            .deploy_contract(JUDGE_WASM.to_vec())
            .function_call("new".to_string(), args.to_string().into_bytes(), deposit.saturating_sub(cost), INIT_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_created(
                judge,
                env::predecessor_account_id(),
                investor_account,
                label,
                U128(deposit.as_yoctonear()),
            ))
    }

    /// Records the strategy, or refunds its creator if the batch failed (the batch's funds came back here).
    #[private]
    pub fn on_created(
        &mut self,
        judge: AccountId,
        creator: AccountId,
        investor_account: Option<String>,
        label: String,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            log!("created {} for {}", judge, creator);
            self.strategies.push(Entry { judge, creator, investor_account, label, created_at: env::block_timestamp() / 1_000_000_000 });
            true
        } else {
            log!("creation of {} failed; refunding {}", judge, creator);
            Promise::new(creator).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            false
        }
    }

    // ---------- the registry ----------

    pub fn count(&self) -> u32 {
        self.strategies.len()
    }

    /// Every strategy created here, oldest first.
    pub fn list_strategies(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Entry> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.strategies.len().min(from.saturating_add(limit))).filter_map(|i| self.strategies.get(i).cloned()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn factory() -> KeelFactory {
        testing_env!(VMContextBuilder::new().current_account_id("keel.testnet".parse().unwrap()).build());
        KeelFactory::new("v1.signer-prod.testnet".parse().unwrap(), 0, 3)
    }

    fn config() -> Value {
        json!({"investor": "0x2b10CDeD26F15B85039D07C85D5A259b9aEa5fD4", "investor_account": "investor.testnet"})
    }

    fn attach(near: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("keel.testnet".parse().unwrap())
            .predecessor_account_id("creator.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(near))
            .build());
    }

    #[test]
    fn names_are_one_safe_label() {
        for ok in ["practice", "my-fund_2", "a1"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["a", "Upper", "has.dot", "-lead", "x".repeat(33).as_str(), "sp ace"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn the_cost_covers_the_embedded_code_and_its_hash_is_published() {
        let f = factory();
        assert!(f.creation_cost().as_yoctonear() > JUDGE_WASM.len() as u128 * 10u128.pow(19));
        assert_eq!(f.judge_code_hash().len(), 64);
    }

    #[test]
    #[should_panic(expected = "attach the creation cost plus a reward pool")]
    fn a_creation_must_fund_storage_and_a_pool() {
        let mut f = factory();
        let cost = f.creation_cost().as_yoctonear();
        attach(cost);
        f.create_strategy("practice".into(), config(), "practice".into()).detach();
    }

    #[test]
    #[should_panic(expected = "config needs the investor's payout address and NEAR account")]
    fn a_strategy_needs_an_investor() {
        let mut f = factory();
        attach(10u128.pow(25));
        f.create_strategy("practice".into(), json!({}), "practice".into()).detach();
    }

    #[test]
    fn the_registry_lists_created_strategies_in_pages_and_refunds_failures() {
        let mut f = factory();
        for i in 0..3 {
            let ok = f.on_created(format!("s{i}.keel.testnet").parse().unwrap(), "creator.testnet".parse().unwrap(), Some("inv.testnet".into()), format!("s{i}"), U128(1), Ok(()));
            assert!(ok);
        }
        assert!(!f.on_created("bad.keel.testnet".parse().unwrap(), "creator.testnet".parse().unwrap(), None, "x".into(), U128(1), Err(PromiseError::Failed)));
        assert_eq!(f.count(), 3);
        let page = f.list_strategies(Some(1), Some(5));
        assert_eq!(page.iter().map(|e| e.label.as_str()).collect::<Vec<_>>(), ["s1", "s2"]);
    }
}
