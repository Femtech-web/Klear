import { describe, expect, it } from "vitest";
import { tally } from "./pulse";

describe("what a judge has paid", () => {
  it("counts a rescue once per job, and every payout's amount", () => {
    const t = tally([
      { job_id: 1, agent: "a", amount: "100", reason: "perp" },
      { job_id: 1, agent: "a", amount: "50", reason: "spot" },
      { job_id: 2, agent: "b", amount: "100", reason: "deleverage" },
      { job_id: 3, agent: "c", amount: "100", reason: "perp" },
      "malformed",
    ]);
    expect([...t.jobs].sort()).toEqual([1, 3]);
    expect(t.yocto).toBe(350n);
  });
});
