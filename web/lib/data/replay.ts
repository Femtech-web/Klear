import data from "@/data/replay.json";

/** The Alpha Arena replay (docs/results/replay, synced by scripts/sync-data.mjs). */

export interface Rescue {
  time: number;
  value: number;
  cost: number;
  returned: number;
}

export interface Agent {
  model: string;
  competition: string;
  address: string;
  source: string;
  start: number;
  end: number;
  initial: number;
  final: number;
  siteFinal: number | null;
  fills: number;
  maxLeverage: number;
  meanLeverage: number;
  leverage: { capX: number; opens: number; refused: number }[];
  floors: { pct: number; investor: number; saved: number; rescue: Rescue | null }[];
  validationError: number | null;
  curve: [number, number][];
}

export const replay = data as unknown as {
  season: string;
  policy: {
    caps_x: number[];
    floors_pct: number[];
    band_bp: number;
    fee_bp: number;
    headline: { cap_x: number; floor_pct: number };
  };
  agents: Agent[];
};

export const CAPS = replay.policy.caps_x;
export const FLOORS = replay.policy.floors_pct;
export const HEADLINE = {
  cap: CAPS.indexOf(replay.policy.headline.cap_x),
  floor: FLOORS.indexOf(replay.policy.headline.floor_pct),
};

export interface Totals {
  agents: number;
  start: number;
  real: number;
  withKeel: number;
  better: number;
  rescued: number;
  worse: number;
  opens: number;
  refused: number;
}

/** Everything the replay says for one leverage cap and one floor, across the agents given. */
export function totals(
  cap: number,
  floor: number,
  agents: Pick<Agent, "initial" | "final" | "leverage" | "floors">[] = replay.agents,
): Totals {
  const t: Totals = {
    agents: agents.length,
    start: 0,
    real: 0,
    withKeel: 0,
    better: 0,
    rescued: 0,
    worse: 0,
    opens: 0,
    refused: 0,
  };
  for (const a of agents) {
    const f = a.floors[floor];
    t.start += a.initial;
    t.real += a.final;
    t.withKeel += f.investor;
    t.rescued += f.rescue ? 1 : 0;
    t.worse += f.saved < 0 ? 1 : 0;
    t.opens += a.leverage[cap].opens;
    t.refused += a.leverage[cap].refused;
  }
  t.better = t.withKeel - t.real;
  return t;
}

/** Agents worst first. */
export const byLoss = [...replay.agents].sort((a, b) => a.final - a.initial - (b.final - b.initial));

export const agentByAddress = (address: string) => replay.agents.find((a) => a.address === address.toLowerCase());

/** The models' own names, as their makers write them. */
const MODEL_NAMES: Record<string, string> = {
  "CLAUDE-SONNET-4-5": "Claude Sonnet 4.5",
  "DEEPSEEK-CHAT-V3.1": "DeepSeek Chat V3.1",
  "GEMINI-3-PRO": "Gemini 3 Pro",
  "GPT-5.1": "GPT-5.1",
  "GROK-4": "Grok 4",
  "GROK-4.20": "Grok 4.20",
  "KIMI-K2-THINKING": "Kimi K2 Thinking",
  "QWEN3-MAX": "Qwen3 Max",
};
export const modelName = (m: string) => MODEL_NAMES[m] ?? m;
/** "3: SITUATIONAL AWARENESS" -> "Situational Awareness". */
export const competitionName = (c: string) =>
  c
    .replace(/^\d+:\s*/, "")
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_, p, c2) => p + c2.toUpperCase());
