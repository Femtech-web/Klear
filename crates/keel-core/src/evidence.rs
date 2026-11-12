//! The log types Keel accepts as evidence, decoded exactly as KeelLeg, KeelVault and BalanceProbe
//! emit them. On NEAR these arrive from Read MPC `verify_foreign_transaction` responses; in local tests
//! they are Foundry logs and prove nothing about a real chain.

use crate::abi::{b32_at, i64_at, topic_address, u128_at, u32_at, u64_at};
use crate::{keccak, Address, Error, B32};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Chain {
    HyperEvm,
    Base,
}

/// One log plus where it came from. `(chain, tx, log_index)` identifies it for replay checks.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Log {
    pub chain: Chain,
    pub tx: B32,
    pub log_index: u64,
    pub emitter: Address,
    pub topics: Vec<B32>,
    #[serde(with = "hexbytes")]
    pub data: Vec<u8>,
}

impl Log {
    pub fn id(&self) -> (Chain, B32, u64) {
        (self.chain, self.tx, self.log_index)
    }
}

/// KeelLeg v5 (the locked G6 judge's leg): no spot USDC fields.
pub const SNAPSHOT_SIG_V5: &str =
    "Snapshot(address,uint32,int64,uint64,uint64,uint64,int64,uint64,uint64,uint64,uint256,uint256,bytes32)";
/// KeelLeg v6: adds the leg's and the payout's HyperCore spot USDC.
pub const SNAPSHOT_SIG: &str =
    "Snapshot(address,uint32,int64,uint64,uint64,uint64,int64,uint64,uint64,uint64,uint64,uint64,uint256,uint256,bytes32)";
pub const BALANCE_SIG: &str = "Balance(address,address,uint256,uint256,uint256,bytes32)";
pub const EXITED_SIG: &str = "Exited(uint64,address,address,uint256,uint256,uint256)";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PerpSnapshot {
    pub account: Address,
    pub perp: u32,
    pub szi: i64,
    pub entry_ntl: u64,
    pub oracle_raw: u64,
    pub mark_raw: u64,
    /// Perp account value (equity) on HyperCore, USD x 1e6.
    pub account_value: i64,
    /// The leg's HyperCore spot USDC, 1e8 per dollar (0 in v5 snapshots).
    #[serde(default)]
    pub spot_usdc: u64,
    /// The payout's HyperCore spot USDC, 1e8 per dollar (0 in v5 snapshots).
    #[serde(default)]
    pub payout_usdc: u64,
    pub l1_block: u64,
    pub last_nonce: u64,
    pub last_queued_l1: u64,
    pub evm_block: u64,
    pub timestamp: u64,
    pub tag: B32,
}

/// KeelVault's payout receipt: its whole `token` balance went to `payout` in this transaction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultExit {
    pub vault: Address,
    pub nonce: u64,
    pub token: Address,
    pub payout: Address,
    #[serde(with = "crate::dec")]
    pub amount: u128,
    pub evm_block: u64,
    pub timestamp: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpotBalance {
    pub account: Address,
    pub token: Address,
    pub balance: u128,
    pub evm_block: u64,
    pub timestamp: u64,
    pub tag: B32,
}

pub fn decode_snapshot(log: &Log) -> Result<PerpSnapshot, Error> {
    if log.chain != Chain::HyperEvm {
        return Err(Error::BadEvidence("snapshot-wrong-chain"));
    }
    let v6 = match log.topics.first().map(|t| t.0) {
        Some(t) if log.topics.len() == 2 && t == keccak(SNAPSHOT_SIG.as_bytes()) => true,
        Some(t) if log.topics.len() == 2 && t == keccak(SNAPSHOT_SIG_V5.as_bytes()) => false,
        _ => return Err(Error::BadEvidence("not-a-snapshot")),
    };
    let extra = if v6 { 2 } else { 0 };
    if log.data.len() != (12 + extra) * 32 {
        return Err(Error::BadEvidence("snapshot-length"));
    }
    let d = &log.data;
    let (spot_usdc, payout_usdc) = if v6 { (u64_at(d, 6)?, u64_at(d, 7)?) } else { (0, 0) };
    Ok(PerpSnapshot {
        account: Bytes(topic_address(&log.topics[1].0)?),
        perp: u32_at(d, 0)?,
        szi: i64_at(d, 1)?,
        entry_ntl: u64_at(d, 2)?,
        oracle_raw: u64_at(d, 3)?,
        mark_raw: u64_at(d, 4)?,
        account_value: i64_at(d, 5)?,
        spot_usdc,
        payout_usdc,
        l1_block: u64_at(d, 6 + extra)?,
        last_nonce: u64_at(d, 7 + extra)?,
        last_queued_l1: u64_at(d, 8 + extra)?,
        evm_block: u64_at(d, 9 + extra)?,
        timestamp: u64_at(d, 10 + extra)?,
        tag: Bytes(b32_at(d, 11 + extra)?),
    })
}

/// `chain` is where the strategy's spot leg lives.
pub fn decode_exited(log: &Log, chain: Chain) -> Result<VaultExit, Error> {
    if log.chain != chain {
        return Err(Error::BadEvidence("exit-wrong-chain"));
    }
    if log.topics.len() != 3 || log.topics[0].0 != keccak(EXITED_SIG.as_bytes()) {
        return Err(Error::BadEvidence("not-an-exit"));
    }
    if log.data.len() != 4 * 32 {
        return Err(Error::BadEvidence("exit-length"));
    }
    let d = &log.data;
    Ok(VaultExit {
        vault: log.emitter,
        nonce: u64_at(&log.topics[1].0, 0)?,
        token: Bytes(topic_address(&log.topics[2].0)?),
        payout: Bytes(topic_address(d[..32].try_into().unwrap())?),
        amount: u128_at(d, 1)?,
        evm_block: u64_at(d, 2)?,
        timestamp: u64_at(d, 3)?,
    })
}

/// `chain` is where the strategy's spot leg lives (Base in the design).
pub fn decode_balance(log: &Log, chain: Chain) -> Result<SpotBalance, Error> {
    if log.chain != chain {
        return Err(Error::BadEvidence("balance-wrong-chain"));
    }
    if log.topics.len() != 3 || log.topics[0].0 != keccak(BALANCE_SIG.as_bytes()) {
        return Err(Error::BadEvidence("not-a-balance"));
    }
    if log.data.len() != 4 * 32 {
        return Err(Error::BadEvidence("balance-length"));
    }
    let d = &log.data;
    Ok(SpotBalance {
        account: Bytes(topic_address(&log.topics[1].0)?),
        token: Bytes(topic_address(&log.topics[2].0)?),
        balance: u128_at(d, 0)?,
        evm_block: u64_at(d, 1)?,
        timestamp: u64_at(d, 2)?,
        tag: Bytes(b32_at(d, 3)?),
    })
}

use crate::Bytes;

mod hexbytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(v)))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        hex::decode(s.trim_start_matches("0x")).map_err(serde::de::Error::custom)
    }
}
