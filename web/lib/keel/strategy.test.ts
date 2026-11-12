import { describe, expect, it } from "vitest";
import { parseStrategy } from "@/lib/keel/strategy";

const raw = {
  mode: "flattened",
  pool: "400000000000000000000000",
  exit_requested: false,
  last_heartbeat: 1794488483,
  config: { manager: "ai.judge.testnet", investor: "0x2b10", investor_account: "investor.judge.testnet", policy: { max_leverage_bp: 10000, equity_floor_usd6: 12000000, heartbeat_s: 600, on_silence: "exit" } },
  rescue: {
    trigger: "manager-silent",
    perp: "delivered",
    spot: "delivered",
    deliveries: [{ leg: "spot", amount: "6000000000000000", evidence: ["base", "0x0869", 8] }],
  },
  payouts: [{ job_id: 1, agent: "guardian.judge.testnet", amount: "300000000000000000000000", reason: "spot" }],
};

describe("parseStrategy", () => {
  it("narrows the judge's JSON to what the site shows", () => {
    const s = parseStrategy(raw);
    expect(s.rescue.trigger).toBe("manager-silent");
    expect(s.rescue.deliveries[0]).toEqual({ leg: "spot", amount: 6_000_000_000_000_000n, evidence: { chain: "base", tx: "0x0869", logIndex: 8 } });
    expect(s.payouts[0].yocto).toBe(300_000_000_000_000_000_000_000n);
    expect(s.policy.onSilence).toBe("exit");
  });
  it("refuses a shape it does not understand rather than showing wrong numbers", () => {
    expect(() => parseStrategy({ ...raw, pool: 4 })).toThrow(/pool/);
    expect(() => parseStrategy({ ...raw, rescue: null })).toThrow(/rescue/);
  });
});
