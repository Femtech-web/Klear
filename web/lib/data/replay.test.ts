import { describe, expect, it } from "vitest";
import { CAPS, FLOORS, HEADLINE, competitionName, modelName, replay, totals } from "@/lib/data/replay";

describe("replay totals", () => {
  it("covers every agent and reproduces the replay's headline", () => {
    const t = totals(HEADLINE.cap, HEADLINE.floor);
    expect(t.agents).toBe(32);
    expect(CAPS[HEADLINE.cap]).toBe(3);
    expect(FLOORS[HEADLINE.floor]).toBe(70);
    // The same numbers docs/results/replay/README.md states.
    expect(Math.round(t.withKeel)).toBe(233621);
    expect(Math.round(t.real)).toBe(176849);
    expect(t.rescued).toBe(23);
    expect(t.worse).toBe(3);
  });

  it("is monotone in the cap: a looser cap never refuses more", () => {
    const refused = CAPS.map((_, i) => totals(i, HEADLINE.floor).refused);
    for (let i = 1; i < refused.length; i++) expect(refused[i]).toBeLessThanOrEqual(refused[i - 1]);
  });

  it("an agent the floor never caught keeps its real result", () => {
    for (const a of replay.agents) {
      for (const f of a.floors) if (!f.rescue) expect(f.investor).toBeCloseTo(a.final, 6);
    }
  });

  it("names every model the replay contains", () => {
    for (const a of replay.agents)
      expect(modelName(a.model)).not.toBe(a.model.toUpperCase() === a.model && a.model !== "GPT-5.1" ? a.model : "");
  });

  it("names read naturally", () => {
    expect(modelName("GROK-4")).toBe("Grok 4");
    expect(modelName("CLAUDE-SONNET-4-5")).toBe("Claude Sonnet 4.5");
    expect(modelName("GPT-5.1")).toBe("GPT-5.1");
    expect(competitionName("3: SITUATIONAL AWARENESS")).toBe("Situational Awareness");
  });
});
