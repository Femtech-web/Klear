//! The Base half of an exit: an EIP-1559 transaction from the strategy's spot account (an MPC key
//! derived for the judge) that moves the spot token to the investor's fixed address. The judge builds
//! it, the MPC signs `signing_hash`, and anyone broadcasts `raw_signed`.

use crate::{keccak, Address};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpotTx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u64,
    pub max_fee_per_gas: u64,
    pub gas: u64,
    pub to: Address,
    #[serde(with = "hexvec")]
    pub data: Vec<u8>,
}

fn int(v: u128) -> Vec<u8> {
    let b = v.to_be_bytes();
    b[b.iter().position(|x| *x != 0).unwrap_or(16)..].to_vec()
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    [rlp_len(b.len(), 0x80), b.to_vec()].concat()
}

fn rlp_len(len: usize, offset: u8) -> Vec<u8> {
    if len <= 55 {
        return vec![offset + len as u8];
    }
    let l = int(len as u128);
    [vec![offset + 55 + l.len() as u8], l].concat()
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload: Vec<u8> = items.concat();
    [rlp_len(payload.len(), 0xc0), payload].concat()
}

impl SpotTx {
    /// `token.transfer(to, amount)`.
    pub fn erc20_transfer(chain_id: u64, nonce: u64, priority: u64, max_fee: u64, gas: u64, token: Address, to: &Address, amount: u128) -> Self {
        let mut data = vec![0xa9, 0x05, 0x9c, 0xbb];
        data.extend_from_slice(&crate::abi::enc_address(&to.0));
        data.extend_from_slice(&crate::abi::enc_u128(amount));
        SpotTx { chain_id, nonce, max_priority_fee_per_gas: priority, max_fee_per_gas: max_fee, gas, to: token, data }
    }

    fn fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_bytes(&int(self.chain_id as u128)),
            rlp_bytes(&int(self.nonce as u128)),
            rlp_bytes(&int(self.max_priority_fee_per_gas as u128)),
            rlp_bytes(&int(self.max_fee_per_gas as u128)),
            rlp_bytes(&int(self.gas as u128)),
            rlp_bytes(&self.to.0),
            rlp_bytes(&[]),
            rlp_bytes(&self.data),
            rlp_list(&[]),
        ]
    }

    pub fn signing_hash(&self) -> [u8; 32] {
        keccak(&[vec![0x02], rlp_list(&self.fields())].concat())
    }

    pub fn raw_signed(&self, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
        let mut f = self.fields();
        f.push(rlp_bytes(&int(y_parity as u128)));
        f.push(rlp_bytes(trim(r)));
        f.push(rlp_bytes(trim(s)));
        [vec![0x02], rlp_list(&f)].concat()
    }
}

fn trim(b: &[u8; 32]) -> &[u8] {
    &b[b.iter().position(|x| *x != 0).unwrap_or(32)..]
}

mod hexvec {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(v)))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        hex::decode(s.trim_start_matches("0x")).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden vector from Python `eth_account` (TypedTransaction.hash / Account.sign_transaction,
    /// key 0x11..11): a TestWETH transfer on Base Sepolia.
    #[test]
    fn matches_eth_account() {
        let to = Address::parse("0x2b10cded26f15b85039d07c85d5a259b9aea5fd4").unwrap();
        let token = Address::parse("0x336c17D19d0c9b03f9B67d54983f9ce70739f2f1").unwrap();
        let tx = SpotTx::erc20_transfer(84532, 3, 1_000_000, 50_000_000, 60_000, token, &to, 6_000_000_000_000_000);
        assert_eq!(hex::encode(tx.signing_hash()), "25543ea95a34e2ca4fd5f1b19cea974cf85705acf4a1650a72385ce19c2022fa");
        let r: [u8; 32] = hex::decode("28edf330f9cc45a890155c0aece31a543aacb4c8667d84a478d6e1dcc4269c62").unwrap().try_into().unwrap();
        let s: [u8; 32] = hex::decode("2c938c534a8a02225461516b53249a2ee3e0213fb2af3fe489aef74cc384b8b9").unwrap().try_into().unwrap();
        assert_eq!(
            hex::encode(tx.raw_signed(0, &r, &s)),
            "02f8b183014a3403830f42408402faf08082ea6094336c17d19d0c9b03f9b67d54983f9ce70739f2f180b844a9059cbb0000000000000000000000002b10cded26f15b85039d07c85d5a259b9aea5fd4000000000000000000000000000000000000000000000000001550f7dca70000c080a028edf330f9cc45a890155c0aece31a543aacb4c8667d84a478d6e1dcc4269c62a02c938c534a8a02225461516b53249a2ee3e0213fb2af3fe489aef74cc384b8b9"
        );
    }
}
