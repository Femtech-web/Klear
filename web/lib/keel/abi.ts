import { keccak_256 } from "@noble/hashes/sha3.js";

/** KeelDeployer calls, ABI-encoded by hand: every argument is a static type, so each is one 32-byte word. */

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const word = (v: bigint | number) => BigInt(v).toString(16).padStart(64, "0");
const address = (a: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};

export const selector = (signature: string) => `0x${hex(keccak_256(utf8(signature))).slice(0, 8)}`;

/** The CREATE2 salt a strategy's EVM accounts use: keccak256 of its NEAR judge account id. */
export const saltFor = (judge: string) => `0x${hex(keccak_256(utf8(judge)))}`;

export interface LegArgs {
  salt: string;
  controller: string;
  payout: string;
  perp: number;
  szDecimals: number;
  maxOrderSz: bigint;
  bandBp: number;
  maxBasisBp: number;
}

const LEG = "(bytes32,address,address,uint32,uint8,uint64,uint16,uint16)";
const VAULT = "(bytes32,address,address)";

function legData(name: "deployLeg" | "predictLeg", a: LegArgs): string {
  if (!/^0x[0-9a-f]{64}$/.test(a.salt)) throw new Error("salt must be 32 bytes");
  return (
    selector(name + LEG) +
    a.salt.slice(2) +
    address(a.controller) +
    address(a.payout) +
    word(a.perp) +
    word(a.szDecimals) +
    word(a.maxOrderSz) +
    word(a.bandBp) +
    word(a.maxBasisBp)
  );
}

function vaultData(name: "deployVault" | "predictVault", salt: string, controller: string, payout: string): string {
  return selector(name + VAULT) + salt.slice(2) + address(controller) + address(payout);
}

export const deployLeg = (a: LegArgs) => legData("deployLeg", a);
export const predictLeg = (a: LegArgs) => legData("predictLeg", a);
export const deployVault = (salt: string, controller: string, payout: string) =>
  vaultData("deployVault", salt, controller, payout);
export const predictVault = (salt: string, controller: string, payout: string) =>
  vaultData("predictVault", salt, controller, payout);

/** An address returned by an eth_call (its last 20 bytes). */
export const returnedAddress = (ret: string) => `0x${ret.slice(-40)}`;

/** zlib's CRC-32, which scripts/testnet/factory.sh uses for a strategy's id. */
export function crc32(s: string): number {
  let c = ~0;
  for (const b of utf8(s)) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
