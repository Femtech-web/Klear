//! Klear's owner contract for a confidential mandate.
//!
//! A NEAR Intents Agent API account holds the money confidentially, under a policy that is the investor's mandate.
//! Its owner is the EVM key NEAR's MPC network derives for this contract, so the owner can sign only what this
//! code asks the MPC network to sign, and the contract is locked (no access keys).
//!
//! Policy changes reach the owner encrypted to the provider's TEE, so no contract can check what they say. So:
//! - **Setup, once.** Until the investor calls `seal`, the investor alone may have anything signed: creating the
//!   account with its policy, and the AI manager's grant. This is the one step taken on trust.
//! - **After `seal`, only what it can read, only on a trigger.** Grant revocations and new grants are EIP-712
//!   `Authorization` messages with a plaintext JSON payload; the contract checks the agent, the network and the owner
//!   in it, and signs only once the investor asked to exit or the manager went silent past its limit. Revoking cuts
//!   the AI off; a new grant can only move money where the sealed policy allows: to the investor.

use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const MPC_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const ISSUE: &str = "near-intents-agent-api.agent-grant.v6";
const ADMIN: &str = "near-intents-agent-api.owner-admin.v2";

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WalletMessage {
    #[serde(rename = "chainId")]
    pub chain_id: String,
    #[serde(rename = "signerId")]
    pub signer_id: String,
    pub nonce: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "timeoutSecs")]
    pub timeout_secs: u32,
    pub ops: String,
    pub out: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Authorization {
    pub purpose: String,
    pub recipient: String,
    pub payload: String,
}

fn keccak(b: &[u8]) -> [u8; 32] {
    env::keccak256_array(b)
}

/// EIP-712 under the API's domain `{ name: "NEAR Wallet Contract", version: "1" }`.
fn digest(struct_hash: [u8; 32]) -> [u8; 32] {
    let mut d = Vec::with_capacity(96);
    d.extend(keccak(b"EIP712Domain(string name,string version)"));
    d.extend(keccak(b"NEAR Wallet Contract"));
    d.extend(keccak(b"1"));
    let domain = keccak(&d);
    let mut m = vec![0x19, 0x01];
    m.extend(domain);
    m.extend(struct_hash);
    keccak(&m)
}

fn uint(v: u32) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[28..].copy_from_slice(&v.to_be_bytes());
    w
}

pub fn wallet_digest(m: &WalletMessage) -> [u8; 32] {
    let mut s = Vec::with_capacity(32 * 8);
    s.extend(keccak(b"WalletMessage(string chainId,string signerId,uint32 nonce,string createdAt,uint32 timeoutSecs,string ops,string out)"));
    s.extend(keccak(m.chain_id.as_bytes()));
    s.extend(keccak(m.signer_id.as_bytes()));
    s.extend(uint(m.nonce));
    s.extend(keccak(m.created_at.as_bytes()));
    s.extend(uint(m.timeout_secs));
    s.extend(keccak(m.ops.as_bytes()));
    s.extend(keccak(m.out.as_bytes()));
    digest(keccak(&s))
}

pub fn authorization_digest(m: &Authorization) -> [u8; 32] {
    let mut s = Vec::with_capacity(32 * 4);
    s.extend(keccak(b"Authorization(string purpose,string recipient,string payload)"));
    s.extend(keccak(m.purpose.as_bytes()));
    s.extend(keccak(m.recipient.as_bytes()));
    s.extend(keccak(m.payload.as_bytes()));
    digest(keccak(&s))
}

/// What a sealed owner will sign: a grant revocation or a new grant for this agent, on mainnet, by this owner.
pub fn readable(m: &Authorization, agent_id: &str, owner: &str) -> Result<&'static str, String> {
    if m.purpose != "PROVE_OWNERSHIP" {
        return Err(format!("purpose {}", m.purpose));
    }
    let p: Value = serde_json::from_str(&m.payload).map_err(|_| "payload is not JSON".to_string())?;
    if p["agent_id"].as_str() != Some(agent_id) {
        return Err("not this owner's agent".into());
    }
    if p["network"].as_str() != Some("mainnet") {
        return Err("not mainnet".into());
    }
    if p["owner"]["address"].as_str().map(str::to_lowercase).as_deref() != Some(owner) {
        return Err("not this owner".into());
    }
    match (p["domain"].as_str(), p["action"].as_str()) {
        (Some(ADMIN), Some("revoke_grant")) => Ok("revoke_grant"),
        (Some(ISSUE), _) => Ok("grant_issue"),
        _ => Err("only grant revocations and grants are signed after seal".into()),
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Owner {
    investor: AccountId,
    manager: AccountId,
    heartbeat_ns: u64,
    last_heartbeat_ns: u64,
    exit_requested: bool,
    mpc: AccountId,
    path: String,
    /// The EVM address NEAR's MPC network derives for (this contract, path), lowercase 0x hex.
    owner: String,
    agent_id: Option<String>,
    sealed: bool,
    signed: u32,
}

#[near]
impl Owner {
    #[init]
    pub fn new(investor: AccountId, manager: AccountId, heartbeat_s: u64, mpc: AccountId, path: String, owner: String) -> Self {
        require!(owner.len() == 42 && owner.starts_with("0x"), "owner: an EVM address");
        Self {
            investor,
            manager,
            heartbeat_ns: heartbeat_s * 1_000_000_000,
            last_heartbeat_ns: env::block_timestamp(),
            exit_requested: false,
            mpc,
            path,
            owner: owner.to_lowercase(),
            agent_id: None,
            sealed: false,
            signed: 0,
        }
    }

    /// The manager, while it runs.
    pub fn heartbeat(&mut self) {
        require!(env::predecessor_account_id() == self.manager, "only the manager");
        self.last_heartbeat_ns = env::block_timestamp();
    }

    /// The investor, at any time.
    pub fn request_exit(&mut self) {
        require!(env::predecessor_account_id() == self.investor, "only the investor");
        self.exit_requested = true;
    }

    /// The investor ends setup: from now on only readable grant changes, on a trigger.
    pub fn seal(&mut self, agent_id: String) {
        require!(env::predecessor_account_id() == self.investor, "only the investor");
        require!(!self.sealed, "already sealed");
        require!(agent_id.len() == 64 && agent_id.bytes().all(|b| b.is_ascii_hexdigit()), "agent_id");
        self.agent_id = Some(agent_id);
        self.sealed = true;
    }

    /// Why the exit is open, if it is.
    pub fn trigger(&self) -> Option<String> {
        if self.exit_requested {
            Some("investor".into())
        } else if env::block_timestamp() > self.last_heartbeat_ns + self.heartbeat_ns {
            Some("manager-silent".into())
        } else {
            None
        }
    }

    /// Setup only (the investor, before `seal`): sign a wallet message, such as the account's creation.
    pub fn sign_setup(&mut self, message: WalletMessage) -> Promise {
        require!(!self.sealed, "sealed: setup is over");
        require!(env::predecessor_account_id() == self.investor, "only the investor sets up");
        self.mpc_sign(wallet_digest(&message), "setup".into())
    }

    /// A grant revocation or a new grant. Before `seal`, the investor's; after, anyone's, once a trigger holds, and
    /// only if the payload names this agent, mainnet and this owner.
    pub fn sign_grant(&mut self, message: Authorization) -> Promise {
        let what = if self.sealed {
            let t = self.trigger().unwrap_or_else(|| env::panic_str("no trigger: the investor has not asked to exit and the manager is not silent"));
            let kind = readable(&message, self.agent_id.as_deref().unwrap(), &self.owner).unwrap_or_else(|e| env::panic_str(&e));
            format!("{kind} on {t}")
        } else {
            require!(env::predecessor_account_id() == self.investor, "only the investor sets up");
            "setup grant".to_string()
        };
        self.mpc_sign(authorization_digest(&message), what)
    }

    fn mpc_sign(&mut self, d: [u8; 32], what: String) -> Promise {
        let args = json!({ "request": { "path": self.path, "payload_v2": { "Ecdsa": hex::encode(d) }, "domain_id": 0 } });
        Promise::new(self.mpc.clone())
            .function_call("sign", args.to_string().into_bytes(), NearToken::from_yoctonear(1), MPC_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(hex::encode(d), what))
    }

    /// The 65-byte EVM signature (r, s, v) the API takes, with what was signed.
    #[private]
    pub fn on_signed(&mut self, digest: String, what: String, #[callback_result] result: Result<Value, PromiseError>) -> Value {
        let resp = result.unwrap_or_else(|_| env::panic_str("the MPC network did not sign"));
        let r = resp["big_r"]["affine_point"].as_str().and_then(|h| hex::decode(h).ok()).filter(|b| b.len() == 33);
        let s = resp["s"]["scalar"].as_str().and_then(|h| hex::decode(h).ok()).filter(|b| b.len() == 32);
        let v = resp["recovery_id"].as_u64().filter(|v| *v <= 1);
        let (Some(r), Some(s), Some(v)) = (r, s, v) else { env::panic_str("unexpected signature shape") };
        self.signed += 1;
        log!("signed {} ({})", digest, what);
        json!({ "digest": digest, "what": what, "signature": format!("0x{}{}{:02x}", hex::encode(&r[1..]), hex::encode(s), 27 + v) })
    }

    pub fn get_state(&self) -> Value {
        json!({
            "investor": self.investor, "manager": self.manager, "heartbeat_s": self.heartbeat_ns / 1_000_000_000,
            "last_heartbeat_ns": self.last_heartbeat_ns.to_string(), "exit_requested": self.exit_requested,
            "trigger": self.trigger(), "mpc": self.mpc, "path": self.path, "owner": self.owner,
            "agent_id": self.agent_id, "sealed": self.sealed, "signed": self.signed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const AGENT: &str = "976397f12f18cdbba7e7abce15346ef9cde9051eb9859dbc51d51e7b93dcf148";
    const OWNER: &str = "0xc21f1df7cfea35180066e10508dc7cc2ee998397";

    fn vectors() -> Value {
        serde_json::from_str(include_str!("../tests/vectors.json")).unwrap()
    }

    #[test]
    fn digests_match_the_ones_the_api_payloads_hash_to() {
        let v = vectors();
        for case in v.as_array().unwrap() {
            let msg = &case["message"];
            let got = match case["primaryType"].as_str().unwrap() {
                "WalletMessage" => wallet_digest(&serde_json::from_value(msg.clone()).unwrap()),
                _ => authorization_digest(&serde_json::from_value(msg.clone()).unwrap()),
            };
            assert_eq!(hex::encode(got), case["digest"].as_str().unwrap(), "{}", case["name"]);
        }
    }

    fn auth(name: &str) -> Authorization {
        let v = vectors();
        let case = v.as_array().unwrap().iter().find(|c| c["name"] == name).unwrap().clone();
        serde_json::from_value(case["message"].clone()).unwrap()
    }

    #[test]
    fn a_sealed_owner_reads_revocations_and_grants_and_refuses_the_rest() {
        assert_eq!(readable(&auth("grant_revoke"), AGENT, OWNER), Ok("revoke_grant"));
        assert_eq!(readable(&auth("grant_issue"), AGENT, OWNER), Ok("grant_issue"));
        assert_eq!(readable(&auth("grant_issue"), &"0".repeat(64), OWNER).unwrap_err(), "not this owner's agent");
        assert_eq!(readable(&auth("grant_issue"), AGENT, "0x0000000000000000000000000000000000000001").unwrap_err(), "not this owner");
        let mut other = auth("grant_issue");
        other.purpose = "SOMETHING_ELSE".into();
        assert!(readable(&other, AGENT, OWNER).is_err());
    }

    fn sealed(silent: bool) -> Owner {
        let ctx = |who: &str, at: u64| VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).block_timestamp(at).build();
        testing_env!(ctx("investor.testnet", 1_000));
        let mut o = Owner::new("investor.testnet".parse().unwrap(), "manager.testnet".parse().unwrap(), 600, "v1.signer-prod.testnet".parse().unwrap(), "klear/mandate/1".into(), OWNER.into());
        o.seal(AGENT.into());
        testing_env!(ctx("stranger.testnet", if silent { 1_000 + 601 * 1_000_000_000 } else { 2_000 }));
        o
    }

    #[test]
    #[should_panic(expected = "no trigger")]
    fn nothing_is_signed_without_a_trigger() {
        let _ = sealed(false).sign_grant(auth("grant_revoke"));
    }

    #[test]
    fn a_silent_manager_opens_revocation_to_anyone() {
        let mut o = sealed(true);
        assert_eq!(o.trigger().as_deref(), Some("manager-silent"));
        let _ = o.sign_grant(auth("grant_revoke"));
    }

    #[test]
    #[should_panic(expected = "sealed: setup is over")]
    fn setup_ends_at_seal() {
        let v = vectors();
        let create = v.as_array().unwrap().iter().find(|c| c["name"] == "agent_create").unwrap()["message"].clone();
        let _ = sealed(true).sign_setup(serde_json::from_value(create).unwrap());
    }

    #[test]
    #[should_panic(expected = "only the manager")]
    fn only_the_manager_beats() {
        sealed(false).heartbeat();
    }
}
