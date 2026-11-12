import { describe, expect, it } from "vitest";
import { base58, evmAddress } from "@/lib/chain/mpc";

describe("MPC-derived EVM addresses", () => {
  it("decodes base58 with leading zeros", () => {
    expect(Array.from(base58("1112"))).toEqual([0, 0, 0, 1]);
  });
  it("matches keel-core's mpc::evm_address on the practice judge's derived key", () => {
    // `derived_public_key` of practice.keel-factory-bcf915.testnet on keel/1/hyperevm; its controller on the live KeelLeg.
    expect(evmAddress(KEY)).toBe("0xa8e150fb95e661dcd48747d230d8655ae5eae7e9");
  });
  it("refuses a key that is not a 64-byte point", () => {
    expect(() => evmAddress("secp256k1:2")).toThrow(/64 bytes/);
  });
});

const KEY = "secp256k1:owNTzpAYqTZ5pydazbXapYsvdodDhMAitZG9iZgjY4ARW2TBHuqcXRChp2AVcsW2haQ9SpMvbpan3CEZYrEwEGU";
