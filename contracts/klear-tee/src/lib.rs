//! Klear's TEE registry: a sealed AI decision, checked on NEAR rather than off chain.
//!
//! 1. `prove_signer`: NEAR's DCAP verifier checks a NEAR AI Cloud model's Intel TDX quote. The quote's 64 bytes
//!    of report_data must be the model's ed25519 signing key followed by the nonce it was asked for (NEAR AI's
//!    binding), its TCB status up to date and debug off. The key is then recorded with its measurements.
//! 2. `verify_receipt`: a sealed manager's receipt, the TEE's ed25519 signature over
//!    `model:sha256(request):sha256(response)`, is checked with NEAR's own ed25519 host function against a key
//!    proven in step 1, and recorded as verified.
//!
//! Anyone can call either; neither can be forged past the checks. Deployed locked (no access keys).

mod dcap;

use near_sdk::json_types::Base64VecU8;
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

/// DCAP `verify_quote` burns about 176 Tgas on testnet.
const DCAP_GAS: Gas = Gas::from_tgas(200);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Signer {
    pub model: String,
    /// The TCB status NEAR's DCAP verifier gave the quote.
    pub tcb_status: String,
    pub mr_td: String,
    pub rtmr0: String,
    pub rtmr1: String,
    pub rtmr2: String,
    pub rtmr3: String,
    pub nonce: String,
    pub proven_at_ns: u64,
    pub proven_by: AccountId,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Receipt {
    pub model: String,
    pub signer: String,
    pub signed_text: String,
    pub verified_at_ns: u64,
    pub verified_by: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Tee {
    dcap_verifier: AccountId,
    /// ed25519 public key (hex) → what its quote proved.
    signers: LookupMap<String, Signer>,
    signer_keys: Vec<String>,
    /// sha256(signed_text) (hex) → the verified receipt.
    receipts: LookupMap<String, Receipt>,
    receipt_count: u32,
}

fn hex32(v: &str, what: &str) -> [u8; 32] {
    let b = hex::decode(v.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str(&format!("{what}: not hex")));
    b.try_into().unwrap_or_else(|_| env::panic_str(&format!("{what}: not 32 bytes")))
}

/// The report's verdict: verified, TCB up to date, debug off, report_data binding exactly this key and nonce.
pub fn judge_quote(result: &dcap::VerificationResult, key: &[u8; 32], nonce: &[u8; 32]) -> Result<(String, [String; 5]), String> {
    let report = match result {
        dcap::VerificationResult::Verified(r) => r,
        dcap::VerificationResult::Rejected(dcap::VerifierError::DcapVerification(e)) => return Err(format!("quote rejected: {e}")),
    };
    if report.status != "UpToDate" {
        return Err(format!("TCB status {}", report.status));
    }
    let td = report.report.td10().ok_or("not a TDX report")?;
    if td.td_attributes[0] & 1 != 0 {
        return Err("the TD runs in debug mode".into());
    }
    if td.report_data[..32] != key[..] || td.report_data[32..] != nonce[..] {
        return Err("report_data does not bind this key and nonce".into());
    }
    let m = [td.mr_td.as_slice(), &td.rt_mr0, &td.rt_mr1, &td.rt_mr2, &td.rt_mr3].map(hex::encode);
    Ok((report.status.clone(), m))
}

#[near]
impl Tee {
    #[init]
    pub fn new(dcap_verifier: AccountId) -> Self {
        Self {
            dcap_verifier,
            signers: LookupMap::new(b"s"),
            signer_keys: Vec::new(),
            receipts: LookupMap::new(b"r"),
            receipt_count: 0,
        }
    }

    /// Anyone: relay a NEAR AI Cloud model's attestation (its TDX quote, Intel's collateral borsh-encoded, the
    /// signing key and the nonce it was requested with). The key is recorded only if NEAR's DCAP verifier accepts
    /// the quote and its report_data binds exactly this key and nonce.
    pub fn prove_signer(&mut self, model: String, signing_key: String, nonce: String, quote: Base64VecU8, collateral: Base64VecU8) -> Promise {
        require!(!model.is_empty() && model.len() <= 128, "model");
        hex32(&signing_key, "signing_key");
        hex32(&nonce, "nonce");
        Promise::new(self.dcap_verifier.clone())
            .function_call("verify_quote", dcap::verify_quote_args(&quote.0, &collateral.0), NearToken::from_yoctonear(0), DCAP_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_quote(model, signing_key, nonce, env::predecessor_account_id()))
    }

    #[private]
    pub fn on_quote(
        &mut self,
        model: String,
        signing_key: String,
        nonce: String,
        by: AccountId,
        #[callback_result]
        #[serializer(borsh)]
        result: Result<dcap::VerificationResult, PromiseError>,
    ) -> bool {
        let key = signing_key.trim_start_matches("0x").to_lowercase();
        let verdict = match result {
            Ok(r) => judge_quote(&r, &hex32(&key, "signing_key"), &hex32(&nonce, "nonce")),
            Err(_) => Err("DCAP verifier call failed".to_string()),
        };
        match verdict {
            Ok((tcb_status, [mr_td, rtmr0, rtmr1, rtmr2, rtmr3])) => {
                log!("signer {} of {} proven on NEAR: TDX {}", key, model, tcb_status);
                if self.signers.get(&key).is_none() {
                    self.signer_keys.push(key.clone());
                }
                let s = Signer { model, tcb_status, mr_td, rtmr0, rtmr1, rtmr2, rtmr3, nonce, proven_at_ns: env::block_timestamp(), proven_by: by };
                self.signers.insert(key, s);
                true
            }
            Err(e) => {
                log!("signer {} not proven: {}", key, e);
                false
            }
        }
    }

    /// Anyone: check a sealed receipt on chain. Its signer must be a key proven by `prove_signer` for the same
    /// model, and the ed25519 signature over `signed_text` must verify; the receipt is then recorded.
    pub fn verify_receipt(&mut self, signed_text: String, signature: String, signing_key: String) -> Receipt {
        let key = signing_key.trim_start_matches("0x").to_lowercase();
        let signer = self.signers.get(&key).unwrap_or_else(|| env::panic_str("signer not proven on NEAR: call prove_signer first")).clone();
        let model = signed_text.split(':').next().unwrap_or_default();
        require!(model == signer.model && signed_text.split(':').count() == 3, "signed_text is not this model's model:request:response");
        let sig = hex::decode(signature.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str("signature: not hex"));
        let sig: [u8; 64] = sig.try_into().unwrap_or_else(|_| env::panic_str("signature: not 64 bytes"));
        require!(env::ed25519_verify(&sig, signed_text.as_bytes(), &hex32(&key, "signing_key")), "signature does not verify");
        let receipt = Receipt {
            model: signer.model,
            signer: key,
            signed_text: signed_text.clone(),
            verified_at_ns: env::block_timestamp(),
            verified_by: env::predecessor_account_id(),
        };
        let id = hex::encode(env::sha256(signed_text.as_bytes()));
        if self.receipts.get(&id).is_none() {
            self.receipt_count += 1;
        }
        self.receipts.insert(id, receipt.clone());
        receipt
    }

    pub fn get_signer(&self, signing_key: String) -> Option<Signer> {
        self.signers.get(&signing_key.trim_start_matches("0x").to_lowercase()).cloned()
    }

    pub fn get_signers(&self) -> Vec<(String, Signer)> {
        self.signer_keys.iter().filter_map(|k| self.signers.get(k).map(|s| (k.clone(), s.clone()))).collect()
    }

    /// A verified receipt, by its signed text.
    pub fn get_receipt(&self, signed_text: String) -> Option<Receipt> {
        self.receipts.get(&hex::encode(env::sha256(signed_text.as_bytes()))).cloned()
    }

    pub fn stats(&self) -> (u32, u32, AccountId) {
        (self.signer_keys.len() as u32, self.receipt_count, self.dcap_verifier.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    // The live sealed hold (docs/results/sealed): NEAR AI Cloud's glm-5.3-flash TEE signed this text.
    const KEY: &str = "5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff";

    fn td(report_data: [u8; 64], debug: bool) -> dcap::VerificationResult {
        let mut attrs = [0u8; 8];
        if debug {
            attrs[0] = 1;
        }
        dcap::VerificationResult::Verified(dcap::VerifiedReport {
            status: "UpToDate".into(),
            advisory_ids: vec![],
            report: dcap::Report::TD10(dcap::TDReport10 {
                tee_tcb_svn: [0; 16],
                mr_seam: [0; 48],
                mr_signer_seam: [0; 48],
                seam_attributes: [0; 8],
                td_attributes: attrs,
                xfam: [0; 8],
                mr_td: [7; 48],
                mr_config_id: [0; 48],
                mr_owner: [0; 48],
                mr_owner_config: [0; 48],
                rt_mr0: [1; 48],
                rt_mr1: [2; 48],
                rt_mr2: [3; 48],
                rt_mr3: [4; 48],
                report_data,
            }),
            ppid: vec![],
            qe_status: dcap::TcbStatusWithAdvisory { status: dcap::TcbStatus::UpToDate, advisory_ids: vec![] },
            platform_status: dcap::TcbStatusWithAdvisory { status: dcap::TcbStatus::UpToDate, advisory_ids: vec![] },
        })
    }

    fn bound(key: [u8; 32], nonce: [u8; 32]) -> [u8; 64] {
        let mut r = [0u8; 64];
        r[..32].copy_from_slice(&key);
        r[32..].copy_from_slice(&nonce);
        r
    }

    #[test]
    fn a_quote_counts_only_when_it_binds_this_key_and_nonce() {
        let key = hex32(KEY, "k");
        let nonce = [9u8; 32];
        assert!(judge_quote(&td(bound(key, nonce), false), &key, &nonce).is_ok());
        assert_eq!(judge_quote(&td(bound(key, [8u8; 32]), false), &key, &nonce).unwrap_err(), "report_data does not bind this key and nonce");
        assert_eq!(judge_quote(&td(bound([1u8; 32], nonce), false), &key, &nonce).unwrap_err(), "report_data does not bind this key and nonce");
        assert_eq!(judge_quote(&td(bound(key, nonce), true), &key, &nonce).unwrap_err(), "the TD runs in debug mode");
        let rejected = dcap::VerificationResult::Rejected(dcap::VerifierError::DcapVerification("bad".into()));
        assert!(judge_quote(&rejected, &key, &nonce).unwrap_err().starts_with("quote rejected"));
    }

    fn proven() -> Tee {
        testing_env!(VMContextBuilder::new().current_account_id("tee.testnet".parse().unwrap()).build());
        let mut t = Tee::new("tee-verifier-2026-07-22.testnet".parse().unwrap());
        let nonce = "09".repeat(32);
        let mut report_data = [0u8; 64];
        report_data[..32].copy_from_slice(&hex32(KEY, "k"));
        report_data[32..].copy_from_slice(&hex32(&nonce, "n"));
        assert!(t.on_quote("z-ai/glm-5.3-flash".into(), KEY.into(), nonce, "anyone.testnet".parse().unwrap(), Ok(td(report_data, false))));
        t
    }

    #[test]
    fn the_live_sealed_receipt_verifies_on_chain_once_its_key_is_proven() {
        let mut t = proven();
        let text = include_str!("../tests/receipt-signed-text.txt").trim().to_string();
        let sig = include_str!("../tests/receipt-signature.txt").trim().to_string();
        let r = t.verify_receipt(text.clone(), sig, KEY.into());
        assert_eq!(r.model, "z-ai/glm-5.3-flash");
        assert_eq!(t.get_receipt(text).unwrap().signer, KEY);
        assert_eq!(t.stats().1, 1);
    }

    #[test]
    #[should_panic(expected = "signature does not verify")]
    fn an_altered_receipt_is_refused() {
        let mut t = proven();
        let text = include_str!("../tests/receipt-signed-text.txt").trim().replace(":6", ":7");
        t.verify_receipt(text, include_str!("../tests/receipt-signature.txt").trim().into(), KEY.into());
    }

    #[test]
    #[should_panic(expected = "signer not proven on NEAR")]
    fn an_unproven_key_is_refused() {
        testing_env!(VMContextBuilder::new().build());
        let mut t = Tee::new("tee-verifier-2026-07-22.testnet".parse().unwrap());
        t.verify_receipt("z-ai/glm-5.3-flash:a:b".into(), "00".repeat(64), KEY.into());
    }
}
