//! NEAR Read MPC (`verify_foreign_transaction`) binding for Keel's evidence logs.
//!
//! The MPC response carries only `payload_hash` and a signature, never the log itself. So the
//! caller states the log it expects, computes the hash the nodes would sign, and passes it as
//! `expected_payload_hash`; the MPC contract only resolves the request if the nodes observed
//! exactly that log at the requested finality. Layout follows near/mpc
//! `near-mpc-contract-interface` (main, Nov 2026):
//! `msg_hash = SHA-256(borsh(ForeignTxSignPayload::V1 { request, values }))`.

use crate::evidence::{Chain, Log};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// `ForeignChainRpcRequest` variant indices.
pub const ETHEREUM: u8 = 1;
pub const BASE: u8 = 6;
pub const HYPER_EVM: u8 = 9;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Finality {
    Latest = 0,
    Safe = 1,
    Finalized = 2,
}

/// The log as an EVM JSON-RPC receipt reports it (`data` is the provider's hex string).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvmLog {
    pub removed: bool,
    pub log_index: u64,
    pub transaction_index: u64,
    pub transaction_hash: [u8; 32],
    pub block_hash: [u8; 32],
    pub block_number: u64,
    pub address: [u8; 20],
    pub data: String,
    pub topics: Vec<[u8; 32]>,
}

pub enum Extracted {
    BlockHash([u8; 32]),
    Log(EvmLog),
}

pub enum Extractor {
    BlockHash,
    Log { log_index: u64 },
}

pub fn chain_variant(c: Chain) -> u8 {
    match c {
        Chain::HyperEvm => HYPER_EVM,
        Chain::Base => BASE,
    }
}

fn u32le(b: &mut Vec<u8>, v: usize) {
    b.extend_from_slice(&(v as u32).to_le_bytes());
}

fn request_borsh(b: &mut Vec<u8>, chain: u8, tx_id: &[u8; 32], extractors: &[Extractor], finality: Finality) {
    b.push(chain);
    b.extend_from_slice(tx_id);
    u32le(b, extractors.len());
    for e in extractors {
        match e {
            Extractor::BlockHash => b.push(0),
            Extractor::Log { log_index } => {
                b.push(1);
                b.extend_from_slice(&log_index.to_le_bytes());
            }
        }
    }
    b.push(finality as u8);
}

pub fn payload_hash(chain: u8, tx_id: &[u8; 32], extractors: &[Extractor], finality: Finality, values: &[Extracted]) -> [u8; 32] {
    let mut b = vec![0u8]; // ForeignTxSignPayload::V1
    request_borsh(&mut b, chain, tx_id, extractors, finality);
    u32le(&mut b, values.len());
    for v in values {
        b.push(1); // ExtractedValue::EvmExtractedValue
        match v {
            Extracted::BlockHash(h) => {
                b.push(0);
                b.extend_from_slice(h);
            }
            Extracted::Log(l) => {
                b.push(1);
                b.push(l.removed as u8);
                b.extend_from_slice(&l.log_index.to_le_bytes());
                b.extend_from_slice(&l.transaction_index.to_le_bytes());
                b.extend_from_slice(&l.transaction_hash);
                b.extend_from_slice(&l.block_hash);
                b.extend_from_slice(&l.block_number.to_le_bytes());
                b.extend_from_slice(&l.address);
                u32le(&mut b, l.data.len());
                b.extend_from_slice(l.data.as_bytes());
                u32le(&mut b, l.topics.len());
                for t in &l.topics {
                    b.extend_from_slice(t);
                }
            }
        }
    }
    Sha256::digest(&b).into()
}

/// Expected hash for one Keel evidence log, and the `verify_foreign_transaction` arguments
/// that bind the MPC response to it.
pub fn log_request(chain: Chain, log: &EvmLog, domain_id: u64) -> ([u8; 32], Value) {
    let finality = Finality::Finalized;
    let ext = [Extractor::Log { log_index: log.log_index }];
    let h = payload_hash(chain_variant(chain), &log.transaction_hash, &ext, finality, &[Extracted::Log(log.clone())]);
    let name = match chain {
        Chain::HyperEvm => "HyperEvm",
        Chain::Base => "Base",
    };
    let args = json!({
        "request": {
            "request": { name: {
                "tx_id": hex::encode(log.transaction_hash),
                "extractors": [{ "Log": { "log_index": log.log_index } }],
                "finality": "Finalized"
            }},
            "domain_id": domain_id,
            "payload_version": 1,
            "expected_payload_hash": hex::encode(h)
        }
    });
    (h, args)
}

impl EvmLog {
    /// A log object exactly as `eth_getTransactionReceipt` returns it.
    pub fn from_rpc(v: &Value) -> Result<Self, String> {
        let s = |k: &str| v[k].as_str().map(str::to_string).ok_or(format!("missing {k}"));
        let q = |k: &str| -> Result<u64, String> {
            u64::from_str_radix(s(k)?.trim_start_matches("0x"), 16).map_err(|e| format!("{k}: {e}"))
        };
        let b32 = |x: &str| crate::B32::parse(x).map(|b| b.0);
        Ok(EvmLog {
            removed: v["removed"].as_bool().unwrap_or(false),
            log_index: q("logIndex")?,
            transaction_index: q("transactionIndex")?,
            transaction_hash: b32(&s("transactionHash")?)?,
            block_hash: b32(&s("blockHash")?)?,
            block_number: q("blockNumber")?,
            address: crate::Address::parse(&s("address")?)?.0,
            data: s("data")?,
            topics: v["topics"]
                .as_array()
                .ok_or("missing topics")?
                .iter()
                .map(|t| b32(t.as_str().unwrap_or_default()))
                .collect::<Result<_, _>>()?,
        })
    }

    /// What the judge consumes once the MPC has confirmed this log.
    pub fn to_evidence(&self, chain: Chain) -> Result<Log, String> {
        let raw = hex::decode(self.data.trim_start_matches("0x")).map_err(|e| e.to_string())?;
        Ok(Log {
            chain,
            tx: crate::Bytes(self.transaction_hash),
            log_index: self.log_index,
            emitter: crate::Bytes(self.address),
            topics: self.topics.iter().map(|t| crate::Bytes(*t)).collect(),
            data: raw,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// near/mpc `foreign_tx_sign_payload_v1_ethereum__should_have_consistent_hash` snapshot.
    #[test]
    fn matches_upstream_snapshot_vector() {
        let h = payload_hash(ETHEREUM, &[0xab; 32], &[Extractor::BlockHash], Finality::Finalized, &[Extracted::BlockHash([0xef; 32])]);
        assert_eq!(hex::encode(h), "2ab97999d1e015730271c7d6cbb298af76fd1de7af81926b42a8877bc4f5794e");
    }

    #[test]
    fn log_hash_binds_every_field() {
        let log = EvmLog {
            removed: false,
            log_index: 2,
            transaction_index: 0,
            transaction_hash: [1; 32],
            block_hash: [2; 32],
            block_number: 100,
            address: [3; 20],
            data: "0x00".into(),
            topics: vec![[4; 32]],
        };
        let (h, _) = log_request(Chain::HyperEvm, &log, 3);
        let mut other = log.clone();
        other.data = "0x01".into();
        assert_ne!(h, log_request(Chain::HyperEvm, &other, 3).0);
        assert_ne!(h, log_request(Chain::Base, &log, 3).0);
    }
}
