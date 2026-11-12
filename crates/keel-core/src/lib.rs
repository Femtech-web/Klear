//! Keel's judge: the rules a NEAR contract applies to attested HyperEVM and Base logs.
//!
//! A repair job may only ever (a) sign bounded IOC orders on the perp leg, computed here from
//! attested state, never chosen by the agent, and (b) pay its agent once, when a later attested
//! snapshot, read after every signed order had time to execute, shows the hedge back within
//! tolerance with the spot leg untouched. Flattening is a separate job kind with its own trigger
//! and its own success condition.

pub mod abi;
pub mod eip712;
pub mod engine;
pub mod evidence;
pub mod mpc;
pub mod px;
pub mod readmpc;
pub mod rules;
pub mod spot;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub fn keccak(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut k = Keccak::v256();
    let mut out = [0u8; 32];
    k.update(data);
    k.finalize(&mut out);
    out
}

/// Fixed-size byte string serialized as 0x-hex.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Bytes<const N: usize>(pub [u8; N]);

pub type Address = Bytes<20>;
pub type B32 = Bytes<32>;

impl<const N: usize> Default for Bytes<N> {
    fn default() -> Self {
        Self([0; N])
    }
}

impl<const N: usize> Bytes<N> {
    pub fn parse(s: &str) -> Result<Self, String> {
        let raw = hex::decode(s.trim_start_matches("0x")).map_err(|e| e.to_string())?;
        let arr: [u8; N] = raw.try_into().map_err(|_| format!("expected {N} bytes"))?;
        Ok(Self(arr))
    }
    pub fn hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }
}

impl<const N: usize> Serialize for Bytes<N> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.hex())
    }
}

impl<'de, const N: usize> Deserialize<'de> for Bytes<N> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Self::parse(&s).map_err(serde::de::Error::custom)
    }
}

/// u128 as a decimal string (the NEAR JSON convention; JSON numbers lose precision past 2^53).
pub mod dec {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        String::deserialize(d)?.parse().map_err(serde::de::Error::custom)
    }
}

/// Every refusal is a stable code so callers (and tests) can match on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    BadEvidence(&'static str),
    EvidenceReused,
    StaleEvidence,
    SnapshotNotSettled,
    AttemptNotResolved,
    UnknownSignedAction,
    WithinTolerance,
    UnexpectedLong,
    JobActive,
    NoOpenJob,
    LossBudgetExhausted,
    RewardPoolEmpty,
    FlattenNotTriggered,
    FlattenInProgress,
    BadPrice,
    MarketDislocated,
    Mandate(&'static str),
    Frozen,
    BadPolicy(&'static str),
}

impl Error {
    pub fn code(&self) -> String {
        match self {
            Error::BadEvidence(why) => format!("bad-evidence:{why}"),
            Error::EvidenceReused => "evidence-reused".into(),
            Error::StaleEvidence => "stale-evidence".into(),
            Error::SnapshotNotSettled => "snapshot-not-settled".into(),
            Error::AttemptNotResolved => "attempt-not-resolved".into(),
            Error::UnknownSignedAction => "unknown-signed-action".into(),
            Error::WithinTolerance => "hedge-within-tolerance".into(),
            Error::UnexpectedLong => "unexpected-long".into(),
            Error::JobActive => "job-active".into(),
            Error::NoOpenJob => "no-open-job".into(),
            Error::LossBudgetExhausted => "loss-budget-exhausted".into(),
            Error::RewardPoolEmpty => "reward-pool-empty".into(),
            Error::FlattenNotTriggered => "flatten-not-triggered".into(),
            Error::FlattenInProgress => "flatten-in-progress".into(),
            Error::BadPrice => "bad-price".into(),
            Error::MarketDislocated => "market-dislocated".into(),
            Error::Mandate(why) => format!("mandate:{why}"),
            Error::Frozen => "strategy-frozen".into(),
            Error::BadPolicy(why) => format!("bad-policy:{why}"),
        }
    }
}
