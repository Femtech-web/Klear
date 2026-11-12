import { describe, expect, it } from "vitest";
import { parseGlance, phase, rescueDue } from "@/lib/keel/registry";

const status = {
  mode: "active",
  exit_requested: false,
  silent: false,
  exit_on_silence: true,
  last_heartbeat: 1794514836,
  heartbeat_s: 900,
  trigger: null,
  cycle: 0,
  pool: "1000010000000000000000000",
  job: null,
  manager: "manager.keel-practice-53ee75.testnet",
  floor_usd6: 3000000,
};

describe("the registry's view of a judge", () => {
  it("reads the judge's status", () => {
    const g = parseGlance(status);
    expect(g.poolYocto).toBe(1_000_010_000_000_000_000_000_000n);
    expect(phase(g)).toBe("watching");
  });
  it("calls a rescue due only on the judge's own triggers", () => {
    expect(rescueDue(parseGlance({ ...status, silent: true }))).toBe("manager-silent");
    expect(rescueDue(parseGlance({ ...status, silent: true, exit_on_silence: false }))).toBeNull();
    expect(rescueDue(parseGlance({ ...status, exit_requested: true }))).toBe("investor");
    expect(rescueDue(parseGlance({ ...status, mode: "flattened", exit_requested: true }))).toBeNull();
  });
  it("names where a strategy is", () => {
    expect(phase(parseGlance({ ...status, silent: true }))).toBe("rescue-due");
    expect(
      phase(
        parseGlance({
          ...status,
          mode: "flattening",
          job: { id: 1, kind: "flatten", agent: "g.testnet", expires_at: 1 },
        }),
      ),
    ).toBe("rescuing");
    expect(phase(parseGlance({ ...status, mode: "flattened" }))).toBe("rescued");
    expect(phase(parseGlance({ ...status, mode: "frozen" }))).toBe("frozen");
  });
  it("refuses a shape it does not understand", () => {
    expect(() => parseGlance({ ...status, mode: 3 })).toThrow(/status/);
  });
});
