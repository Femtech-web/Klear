//! NEAR Chain Signatures plumbing for KeelLeg's controller: the EVM address of a derived key,
//! the `sign` arguments for an order digest, and the response converted to (v, r, s).

use crate::keccak;
use serde_json::{json, Value};

const B58: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub fn base58_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    for c in s.bytes() {
        let mut carry = B58.iter().position(|b| *b == c).ok_or("bad base58")? as u32;
        for b in out.iter_mut().rev() {
            carry += *b as u32 * 58;
            *b = carry as u8;
            carry >>= 8;
        }
        while carry > 0 {
            out.insert(0, carry as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|c| *c == b'1').count();
    Ok([vec![0; zeros], out].concat())
}

/// `secp256k1:<base58 of the 64-byte uncompressed point>` -> EVM address.
pub fn evm_address(near_key: &str) -> Result<[u8; 20], String> {
    let raw = base58_decode(near_key.strip_prefix("secp256k1:").ok_or("not a secp256k1 key")?)?;
    if raw.len() != 64 {
        return Err(format!("expected 64 bytes, got {}", raw.len()));
    }
    Ok(keccak(&raw)[12..].try_into().unwrap())
}

/// Arguments for `v1.signer-prod.testnet` `sign`.
pub fn sign_args(path: &str, digest: &[u8; 32], domain_id: u64) -> Value {
    json!({ "request": { "path": path, "payload_v2": { "Ecdsa": hex::encode(digest) }, "domain_id": domain_id } })
}

/// Secp256k1 `SignatureResponse` -> (v, r, s) for `ecrecover`.
pub fn vrs(resp: &Value) -> Result<(u8, [u8; 32], [u8; 32]), String> {
    let big_r = resp["big_r"]["affine_point"].as_str().ok_or("missing big_r.affine_point")?;
    let s = resp["s"]["scalar"].as_str().ok_or("missing s.scalar")?;
    let rec = resp["recovery_id"].as_u64().ok_or("missing recovery_id")?;
    let r = hex::decode(big_r).map_err(|e| e.to_string())?;
    if r.len() != 33 || rec > 1 {
        return Err("unexpected signature shape".into());
    }
    let s = hex::decode(s).map_err(|e| e.to_string())?;
    Ok((27 + rec as u8, r[1..].try_into().unwrap(), s.try_into().map_err(|_| "s length")?))
}
