//! The digests NEAR's MPC signs for KeelLeg (orders, sweeps) and KeelVault (exits). Each must equal
//! the contract's own digest function byte for byte.

use crate::abi::{enc_address, enc_bool, enc_u128, enc_u64};
use crate::{keccak, Address};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    pub nonce: u64,
    pub is_buy: bool,
    pub limit_px: u64,
    pub sz: u64,
    pub reduce_only: bool,
    #[serde(with = "crate::dec")]
    pub cloid: u128,
    pub deadline: u64,
}

const DOMAIN: &str = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const SWEEP: &str = "Sweep(uint64 nonce,uint64 usdNtl,uint64 usdcWei,uint64 deadline)";

/// KeelLeg's sweep: perp margin -> spot -> its fixed payout address.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sweep {
    pub nonce: u64,
    pub usd_ntl: u64,
    pub usdc_wei: u64,
    pub deadline: u64,
}

pub fn sweep_digest(chain_id: u64, leg: &Address, w: &Sweep) -> [u8; 32] {
    let mut s = Vec::with_capacity(5 * 32);
    s.extend_from_slice(&keccak(SWEEP.as_bytes()));
    for v in [w.nonce, w.usd_ntl, w.usdc_wei, w.deadline] {
        s.extend_from_slice(&enc_u64(v));
    }
    let mut m = Vec::with_capacity(66);
    m.extend_from_slice(b"\x19\x01");
    m.extend_from_slice(&domain_separator(chain_id, leg));
    m.extend_from_slice(&keccak(&s));
    keccak(&m)
}

const ORDER: &str = "Order(uint64 nonce,bool isBuy,uint64 limitPx,uint64 sz,bool reduceOnly,uint128 cloid,uint64 deadline)";

pub fn domain_separator(chain_id: u64, leg: &Address) -> [u8; 32] {
    domain(b"KeelLeg", chain_id, leg)
}

fn domain(name: &[u8], chain_id: u64, contract: &Address) -> [u8; 32] {
    let mut b = Vec::with_capacity(5 * 32);
    b.extend_from_slice(&keccak(DOMAIN.as_bytes()));
    b.extend_from_slice(&keccak(name));
    b.extend_from_slice(&keccak(b"1"));
    b.extend_from_slice(&enc_u64(chain_id));
    b.extend_from_slice(&enc_address(&contract.0));
    keccak(&b)
}

const EXIT: &str = "Exit(uint64 nonce,address token,uint64 deadline)";

/// KeelVault's exit: its whole balance of `token` to its fixed payout.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exit {
    pub nonce: u64,
    pub token: Address,
    pub deadline: u64,
}

pub fn exit_digest(chain_id: u64, vault: &Address, x: &Exit) -> [u8; 32] {
    let mut s = Vec::with_capacity(4 * 32);
    s.extend_from_slice(&keccak(EXIT.as_bytes()));
    s.extend_from_slice(&enc_u64(x.nonce));
    s.extend_from_slice(&enc_address(&x.token.0));
    s.extend_from_slice(&enc_u64(x.deadline));
    let mut m = Vec::with_capacity(66);
    m.extend_from_slice(b"\x19\x01");
    m.extend_from_slice(&domain(b"KeelVault", chain_id, vault));
    m.extend_from_slice(&keccak(&s));
    keccak(&m)
}

pub fn order_digest(chain_id: u64, leg: &Address, o: &Order) -> [u8; 32] {
    let mut s = Vec::with_capacity(8 * 32);
    s.extend_from_slice(&keccak(ORDER.as_bytes()));
    s.extend_from_slice(&enc_u64(o.nonce));
    s.extend_from_slice(&enc_bool(o.is_buy));
    s.extend_from_slice(&enc_u64(o.limit_px));
    s.extend_from_slice(&enc_u64(o.sz));
    s.extend_from_slice(&enc_bool(o.reduce_only));
    s.extend_from_slice(&enc_u128(o.cloid));
    s.extend_from_slice(&enc_u64(o.deadline));
    let mut m = Vec::with_capacity(66);
    m.extend_from_slice(b"\x19\x01");
    m.extend_from_slice(&domain_separator(chain_id, leg));
    m.extend_from_slice(&keccak(&s));
    keccak(&m)
}
