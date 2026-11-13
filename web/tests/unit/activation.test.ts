import { describe, expect, it } from "vitest";
import { activationStep, decimalUnits, splitSignature, usdAction, usdTypedData, wethTransfer } from "@/lib/activation";

describe("funding amounts and signatures", () => {
  it("keeps exact wei and refuses rounded, signed or exponential amounts", () => {
    expect(decimalUnits("0.000000000000000001", 18)).toBe(1n);
    expect(decimalUnits("12.000001", 6)).toBe(12000001n);
    for (const amount of ["0", "-1", "1e3", "1.0000001", "Infinity", "00.1", " 1", "1."])
      expect(() => decimalUnits(amount, 6), amount).toThrow();
    expect(wethTransfer(`0x${"a".repeat(40)}`, 1n)).toBe(
      `0xa9059cbb${"a".repeat(40).padStart(64, "0")}${"1".padStart(64, "0")}`,
    );
  });
  it("matches Hyperliquid's user-signed USD transfer schema and binds Testnet", () => {
    const action = usdAction(`0x${"b".repeat(40)}`, "12.000001", 1700000000000);
    const typed = usdTypedData(action);
    expect(action).toEqual({
      type: "usdSend",
      hyperliquidChain: "Testnet",
      signatureChainId: "0x3e6",
      destination: `0x${"b".repeat(40)}`,
      amount: "12.000001",
      time: 1700000000000,
    });
    expect(typed.primaryType).toBe("HyperliquidTransaction:UsdSend");
    expect(typed.domain).toEqual({
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: 998,
      verifyingContract: `0x${"0".repeat(40)}`,
    });
    expect(
      typed.types[typed.primaryType as "HyperliquidTransaction:UsdSend"].map((field) => `${field.name}:${field.type}`),
    ).toEqual(["hyperliquidChain:string", "destination:string", "amount:string", "time:uint64"]);
    expect(splitSignature(`0x${"a".repeat(64)}${"b".repeat(64)}01`)).toEqual({
      r: `0x${"a".repeat(64)}`,
      s: `0x${"b".repeat(64)}`,
      v: 28,
    });
    expect(() => splitSignature(`0x${"a".repeat(128)}03`)).toThrow();
  });
});

it("never lets missing verification or an exit state become a funded startup", () => {
  expect(activationStep({ verified: false, funded: true, mode: "active" })).toBe("deploy");
  expect(activationStep({ verified: true, funded: false, mode: "active" })).toBe("fund");
  expect(activationStep({ verified: true, funded: true, mode: "active" })).toBe("manager");
  expect(activationStep({ verified: true, funded: true, mode: "active", silent: true, exitOnSilence: true })).toBe(
    "manage",
  );
  expect(activationStep({ verified: true, funded: false, mode: "flattened" })).toBe("manage");
});
