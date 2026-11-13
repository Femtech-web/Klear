//! What NEAR's DCAP verifier returns, as borsh mirrors of near/mpc's `tee-verifier-interface` (the same mirrors
//! Encore's T1 contract uses), and the arguments it takes.

use near_sdk::near;

// Borsh mirrors of near/mpc `tee-verifier-interface`: what the DCAP verifier's `verify_quote` returns.

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum VerificationResult {
    Verified(VerifiedReport),
    Rejected(VerifierError),
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub enum VerifierError {
    DcapVerification(String),
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct VerifiedReport {
    pub status: String,
    pub advisory_ids: Vec<String>,
    pub report: Report,
    pub ppid: Vec<u8>,
    pub qe_status: TcbStatusWithAdvisory,
    pub platform_status: TcbStatusWithAdvisory,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum Report {
    SgxEnclave(EnclaveReport),
    TD10(TDReport10),
    TD15(TDReport15),
    TD15Ex(TDReport15Ex),
}

impl Report {
    pub fn td10(&self) -> Option<&TDReport10> {
        match self {
            Report::TD10(r) => Some(r),
            Report::TD15(r) => Some(&r.base),
            Report::TD15Ex(r) => Some(&r.base.base),
            Report::SgxEnclave(_) => None,
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct TDReport10 {
    pub tee_tcb_svn: [u8; 16],
    pub mr_seam: [u8; 48],
    pub mr_signer_seam: [u8; 48],
    pub seam_attributes: [u8; 8],
    pub td_attributes: [u8; 8],
    pub xfam: [u8; 8],
    pub mr_td: [u8; 48],
    pub mr_config_id: [u8; 48],
    pub mr_owner: [u8; 48],
    pub mr_owner_config: [u8; 48],
    pub rt_mr0: [u8; 48],
    pub rt_mr1: [u8; 48],
    pub rt_mr2: [u8; 48],
    pub rt_mr3: [u8; 48],
    pub report_data: [u8; 64],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct TDReport15 {
    pub base: TDReport10,
    pub tee_tcb_svn2: [u8; 16],
    pub mr_service_td: [u8; 48],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct TDReport15Ex {
    pub base: TDReport15,
    pub vmid: u8,
    pub td_id: [u8; 32],
    pub dev_info: [u8; 48],
    pub init_service_td_hash: [u8; 48],
    pub init_service_td_attributes: [u8; 8],
    pub init_cpu_svn: [u8; 16],
    pub init_tee_tcb_svn: [u8; 16],
    pub init_tee_fmspc: [u8; 12],
    pub cur_service_td_hash: [u8; 48],
    pub cur_service_td_attributes: [u8; 8],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct EnclaveReport {
    pub cpu_svn: [u8; 16],
    pub misc_select: u32,
    pub reserved1: [u8; 28],
    pub attributes: [u8; 16],
    pub mr_enclave: [u8; 32],
    pub reserved2: [u8; 32],
    pub mr_signer: [u8; 32],
    pub reserved3: [u8; 96],
    pub isv_prod_id: u16,
    pub isv_svn: u16,
    pub reserved4: [u8; 60],
    pub report_data: [u8; 64],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub enum TcbStatus {
    UpToDate,
    OutOfDateConfigurationNeeded,
    OutOfDate,
    ConfigurationAndSWHardeningNeeded,
    ConfigurationNeeded,
    SWHardeningNeeded,
    Revoked,
    TDRelaunchAdvised,
    TDRelaunchAdvisedConfigurationNeeded,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct TcbStatusWithAdvisory {
    pub status: TcbStatus,
    pub advisory_ids: Vec<String>,
}

/// Arguments for `verify_quote`: borsh `(Vec<u8> quote, Collateral)`; the collateral arrives already
/// borsh-encoded (`scripts/testnet/tee.py` writes it in dcap-qvl's `QuoteCollateralV3` order).
pub fn verify_quote_args(quote: &[u8], collateral: &[u8]) -> Vec<u8> {
    let mut args = Vec::with_capacity(quote.len() + collateral.len() + 4);
    args.extend((quote.len() as u32).to_le_bytes());
    args.extend(quote);
    args.extend(collateral);
    args
}
