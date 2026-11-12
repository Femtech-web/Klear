import { keccak_256 } from "@noble/hashes/sha3.js";
import { view } from "@/lib/chain/near";

/** NEAR Chain Signatures: the EVM address of the key the MPC network derives for (account, path). */

const MPC = "v1.signer-prod.testnet";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const d = ALPHABET.indexOf(c);
    if (d < 0) throw new Error("base58: bad character");
    n = n * 58n + BigInt(d);
  }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
  for (const c of text) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** `secp256k1:<base58 of the 64-byte uncompressed point>` to its EVM address (keel-core's `mpc::evm_address`). */
export function evmAddress(nearKey: string): string {
  const raw = base58(nearKey.replace(/^secp256k1:/, ""));
  if (raw.length !== 64) throw new Error(`expected 64 bytes, got ${raw.length}`);
  return "0x" + Buffer.from(keccak_256(raw).slice(12)).toString("hex");
}

/** The address only `account` can have the MPC network sign for, on `path`. */
export async function derivedAddress(account: string, path: string): Promise<string> {
  return evmAddress(String(await view(MPC, "derived_public_key", { path, predecessor: account, domain_id: 0 })));
}
