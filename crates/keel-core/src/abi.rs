//! Strict decoding of static ABI words. A word that does not hold a canonical value of the
//! expected type is rejected rather than truncated.

use crate::Error;

pub fn word(data: &[u8], i: usize) -> Result<&[u8], Error> {
    data.get(i * 32..i * 32 + 32).ok_or(Error::BadEvidence("short-data"))
}

fn high_zero(w: &[u8], keep: usize) -> bool {
    w[..32 - keep].iter().all(|b| *b == 0)
}

pub fn u64_at(data: &[u8], i: usize) -> Result<u64, Error> {
    let w = word(data, i)?;
    if !high_zero(w, 8) {
        return Err(Error::BadEvidence("non-canonical-uint"));
    }
    Ok(u64::from_be_bytes(w[24..].try_into().unwrap()))
}

pub fn u32_at(data: &[u8], i: usize) -> Result<u32, Error> {
    let w = word(data, i)?;
    if !high_zero(w, 4) {
        return Err(Error::BadEvidence("non-canonical-uint"));
    }
    Ok(u32::from_be_bytes(w[28..].try_into().unwrap()))
}

pub fn u128_at(data: &[u8], i: usize) -> Result<u128, Error> {
    let w = word(data, i)?;
    if !high_zero(w, 16) {
        return Err(Error::BadEvidence("uint-too-large"));
    }
    Ok(u128::from_be_bytes(w[16..].try_into().unwrap()))
}

/// int64: the 24 high bytes must be the sign extension of the low 8.
pub fn i64_at(data: &[u8], i: usize) -> Result<i64, Error> {
    let w = word(data, i)?;
    let v = i64::from_be_bytes(w[24..].try_into().unwrap());
    let fill = if v < 0 { 0xff } else { 0 };
    if w[..24].iter().any(|b| *b != fill) {
        return Err(Error::BadEvidence("non-canonical-int"));
    }
    Ok(v)
}

pub fn b32_at(data: &[u8], i: usize) -> Result<[u8; 32], Error> {
    Ok(word(data, i)?.try_into().unwrap())
}

pub fn topic_address(t: &[u8; 32]) -> Result<[u8; 20], Error> {
    if !t[..12].iter().all(|b| *b == 0) {
        return Err(Error::BadEvidence("non-canonical-address"));
    }
    Ok(t[12..].try_into().unwrap())
}

pub fn enc_u64(v: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&v.to_be_bytes());
    w
}

pub fn enc_u128(v: u128) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&v.to_be_bytes());
    w
}

pub fn enc_bool(v: bool) -> [u8; 32] {
    enc_u64(v as u64)
}

pub fn enc_address(a: &[u8; 20]) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a);
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int64_requires_sign_extension() {
        let mut w = [0xffu8; 32];
        w[24..].copy_from_slice(&(-6000i64).to_be_bytes());
        assert_eq!(i64_at(&w, 0), Ok(-6000));
        w[0] = 0;
        assert_eq!(i64_at(&w, 0), Err(Error::BadEvidence("non-canonical-int")));
        let mut p = [0u8; 32];
        p[24..].copy_from_slice(&6000i64.to_be_bytes());
        assert_eq!(i64_at(&p, 0), Ok(6000));
    }

    #[test]
    fn uint_rejects_dirty_high_bytes() {
        let mut w = enc_u64(7);
        assert_eq!(u64_at(&w, 0), Ok(7));
        w[3] = 1;
        assert!(u64_at(&w, 0).is_err());
        assert!(u64_at(&w[..31], 0).is_err());
    }
}
