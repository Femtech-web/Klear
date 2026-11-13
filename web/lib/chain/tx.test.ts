import { describe, expect, it } from "vitest";
import { base58 } from "./mpc";
import { base58Encode, encodeTransaction, refusalOf } from "./tx";

describe("a signed NEAR function call", () => {
  it("lays the transaction out as nearcore's borsh does", () => {
    const bytes = encodeTransaction({
      signer: "a.testnet",
      publicKey: new Uint8Array(32).fill(1),
      nonce: 7n,
      receiver: "b.testnet",
      blockHash: new Uint8Array(32).fill(2),
      method: "m",
      args: Buffer.from("{}"),
      gas: 30n * 10n ** 12n,
      deposit: 1n,
    });
    const at = (n: number) => bytes.subarray(n);
    expect(bytes.readUInt32LE(0)).toBe(9);
    expect(at(4).subarray(0, 9).toString()).toBe("a.testnet");
    expect(bytes[13]).toBe(0); // ed25519
    expect(bytes.readBigUInt64LE(46)).toBe(7n);
    expect(bytes.readUInt32LE(54)).toBe(9);
    expect(bytes.readUInt32LE(99)).toBe(1); // one action
    expect(bytes[103]).toBe(2); // FunctionCall
    expect(bytes.readBigUInt64LE(bytes.length - 24)).toBe(30n * 10n ** 12n);
    expect(bytes.readBigUInt64LE(bytes.length - 16)).toBe(1n); // u128 deposit, low half first
    expect(bytes.readBigUInt64LE(bytes.length - 8)).toBe(0n);
    expect(bytes.length).toBe(104 + 4 + 1 + 4 + 2 + 8 + 16);
  });

  it("encodes base58 as NEAR does, leading zeros included", () => {
    const raw = Uint8Array.from([0, 0, 1, 2, 255, 7]);
    expect(base58(base58Encode(raw))).toEqual(raw);
    expect(base58Encode(Uint8Array.from([0]))).toBe("1");
  });

  it("reads the judge's refusal, or the runtime's", () => {
    const panic = {
      Failure: {
        ActionError: {
          kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: mandate:not-the-manager" } },
        },
      },
    };
    const missing = {
      Failure: { ActionError: { kind: { FunctionCallError: { MethodResolveError: "MethodNotFound" } } } },
    };
    expect(refusalOf(panic)).toBe("mandate:not-the-manager");
    expect(refusalOf(missing)).toBe("no such method");
    expect(refusalOf({ SuccessValue: "" })).toBeNull();
  });
});
