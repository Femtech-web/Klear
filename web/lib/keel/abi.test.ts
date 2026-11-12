import { describe, expect, it } from "vitest";
import { crc32, predictLeg, saltFor, selector } from "@/lib/keel/abi";

// Reference values from Foundry's cast and Python's zlib, for the practice strategy the factory created.
const SALT = "0xc4a1fbc9b05226675b387aedad04cdddb2d887311a69b1f6b11599d2e3a4ba47";
const CAST =
  "0xd4f3ed1fc4a1fbc9b05226675b387aedad04cdddb2d887311a69b1f6b11599d2e3a4ba47000000000000000000000000a8e150fb95e661dcd48747d230d8655ae5eae7e90000000000000000000000001d9db7f01d68cf06b3a2d2498af09a09f186615c0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000001f4";

describe("KeelDeployer calls", () => {
  it("salts a strategy with keccak256 of its judge, as factory.sh does", () => {
    expect(saltFor("practice.keel-factory-bcf915.testnet")).toBe(SALT);
  });
  it("encodes predictLeg exactly as cast calldata does", () => {
    const data = predictLeg({
      salt: SALT,
      controller: "0xa8e150fb95e661dcd48747d230d8655ae5eae7e9",
      payout: "0x1d9Db7f01d68CF06B3A2D2498af09a09f186615c",
      perp: 4,
      szDecimals: 4,
      maxOrderSz: 1_000_000n,
      bandBp: 100,
      maxBasisBp: 500,
    });
    expect(data).toBe(CAST);
    expect(selector("predictLeg(bytes32,address,address,uint32,uint8,uint64,uint16,uint16)")).toBe("0xd4f3ed1f");
  });
  it("refuses an address that is not one", () => {
    expect(() => predictLeg({ salt: SALT, controller: "0x12", payout: "0x1d9Db7f01d68CF06B3A2D2498af09a09f186615c", perp: 4, szDecimals: 4, maxOrderSz: 1n, bandBp: 1, maxBasisBp: 1 })).toThrow(/address/);
  });
  it("derives a strategy id as zlib.crc32 does", () => {
    expect(crc32("practice")).toBe(2146186318);
  });
});
