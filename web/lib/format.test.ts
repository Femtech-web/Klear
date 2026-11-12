import { describe, expect, it } from "vitest";
import { near, pct, short, units, usd, txUrl } from "@/lib/format";

describe("format", () => {
  it("formats NEAR from yocto without float drift", () => {
    expect(near(500_000_000_000_000_000_000_000n)).toBe("0.5 NEAR");
    expect(near(1_200_000_000_000_000_000_000_000n)).toBe("1.2 NEAR");
    expect(near(0n)).toBe("0 NEAR");
  });
  it("formats token units", () => {
    expect(units(6_000_000_000_000_000n, 18)).toBe("0.006");
    expect(units(788_675_500n, 8, 3)).toBe("7.886");
  });
  it("formats money, shares and hashes", () => {
    expect(usd(6801.4)).toBe("$6,801");
    expect(pct(0.897)).toBe("90%");
    expect(short("0x08692bb796eccf3787e18893684a5a713e7587ab9e86efde79e7854d9979b2ac")).toBe("0x0869…b2ac");
  });
  it("links each chain's explorer", () => {
    expect(txUrl("near", "ABC")).toBe("https://testnet.nearblocks.io/txns/ABC");
    expect(txUrl("base", "0x1")).toBe("https://sepolia.basescan.org/tx/0x1");
  });
});
