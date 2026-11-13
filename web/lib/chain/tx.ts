import { createHash, createPrivateKey, sign } from "node:crypto";
import { config } from "@/lib/config";
import { base58 } from "@/lib/chain/mpc";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** One NEAR function call, signed on the server with a full-access ed25519 key and sent to testnet. */

export type Sent = {
  hash: string;
  /** The contract's or the runtime's reason, when the call failed; null when it succeeded. */
  refusal: string | null;
};

class Borsh {
  private parts: Buffer[] = [];
  u8(n: number) {
    this.parts.push(Buffer.from([n]));
  }
  u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    this.parts.push(b);
  }
  u64(n: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    this.parts.push(b);
  }
  u128(n: bigint) {
    this.u64(n & 0xffffffffffffffffn);
    this.u64(n >> 64n);
  }
  bytes(b: Uint8Array) {
    this.u32(b.length);
    this.parts.push(Buffer.from(b));
  }
  fixed(b: Uint8Array) {
    this.parts.push(Buffer.from(b));
  }
  string(s: string) {
    this.bytes(Buffer.from(s, "utf8"));
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** The borsh bytes of a Transaction with one FunctionCall action (nearcore's layout). */
export function encodeTransaction(t: {
  signer: string;
  publicKey: Uint8Array;
  nonce: bigint;
  receiver: string;
  blockHash: Uint8Array;
  method: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}): Buffer {
  const w = new Borsh();
  w.string(t.signer);
  w.u8(0); // ed25519
  w.fixed(t.publicKey);
  w.u64(t.nonce);
  w.string(t.receiver);
  w.fixed(t.blockHash);
  w.u32(1);
  w.u8(2); // Action::FunctionCall
  w.string(t.method);
  w.bytes(t.args);
  w.u64(t.gas);
  w.u128(t.deposit);
  return w.done();
}

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** `ed25519:<base58 of seed ‖ public key>`, as NEAR CLI stores it. */
function keyPair(secret: string): { seed: Buffer; publicKey: Uint8Array } {
  const raw = base58(secret.replace(/^ed25519:/, ""));
  if (raw.length !== 64) throw new Error("expected a 64-byte ed25519 secret key");
  return { seed: Buffer.from(raw.slice(0, 32)), publicKey: raw.slice(32) };
}

/** The runtime's failure, read as the short reason a person can understand. */
export function refusalOf(status: unknown): string | null {
  if (!isRecord(status) || !("Failure" in status)) return null;
  const text = JSON.stringify(status.Failure);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1].trim();
  if (text.includes("MethodNotFound")) return "no such method";
  return text.slice(0, 160);
}

export async function functionCall(
  signer: string,
  secretKey: string,
  receiver: string,
  method: string,
  args: Record<string, unknown>,
  tgas = 30,
): Promise<Sent> {
  const { seed, publicKey } = keyPair(secretKey);
  const access = await postJson(config.nearRpc, {
    jsonrpc: "2.0",
    id: "klear-break",
    method: "query",
    params: {
      request_type: "view_access_key",
      finality: "final",
      account_id: signer,
      public_key: `ed25519:${base58Encode(publicKey)}`,
    },
  });
  if (!isRecord(access) || !isRecord(access.result)) throw new Error("NEAR RPC: no access key");
  const { nonce, block_hash } = access.result as { nonce: number; block_hash: string };
  const tx = encodeTransaction({
    signer,
    publicKey,
    nonce: BigInt(nonce) + 1n,
    receiver,
    blockHash: base58(block_hash),
    method,
    args: Buffer.from(JSON.stringify(args)),
    gas: BigInt(tgas) * 10n ** 12n,
    deposit: 0n,
  });
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const signature = sign(null, createHash("sha256").update(tx).digest(), key);
  const signed = Buffer.concat([tx, Buffer.from([0]), signature]);
  const r = await postJson(config.nearRpc, {
    jsonrpc: "2.0",
    id: "klear-break",
    method: "send_tx",
    params: { signed_tx_base64: signed.toString("base64"), wait_until: "EXECUTED_OPTIMISTIC" },
  });
  if (!isRecord(r) || !isRecord(r.result)) {
    throw new Error(`NEAR RPC: ${isRecord(r) && r.error ? JSON.stringify(r.error).slice(0, 200) : "no result"}`);
  }
  const transaction = r.result.transaction as { hash: string };
  return { hash: transaction.hash, refusal: refusalOf(r.result.status) };
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  for (; n > 0n; n /= 58n) out = ALPHABET[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
