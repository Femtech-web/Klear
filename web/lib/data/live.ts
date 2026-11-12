import deployments from "@/data/deployments.json";
import moment from "@/data/moment.json";
import attacks from "@/data/attacks.json";
import challenges from "@/data/challenges.json";
import factoryData from "@/data/factory.json";
import drillData from "@/data/drill.json";
import type { Chain } from "@/lib/format";

/** The live testnet runs (docs/results/g7, synced by scripts/sync-data.mjs). */

export type StepKind = "setup" | "ai" | "refused" | "disclosed" | "trigger" | "rescue" | "paid";

export interface Step {
  kind: StepKind;
  title: string;
  detail: string;
  quote?: string;
  code?: string;
  txs: { chain: Chain; id: string }[];
}

export const timeline = moment as unknown as {
  generated: string;
  strategies: Record<"ai" | "human", { title: string; steps: Step[] }>;
};

export const deployment = deployments as {
  investor: string;
  weth: string;
  localBuildSha256: string;
  strategies: {
    name: "ai" | "human";
    judge: string;
    leg: string;
    vault: string;
    controller: string;
    vaultController: string;
  }[];
};

export const liveAttacks = attacks as {
  strategy: string;
  attempt: string;
  tx: string | null;
  where: string | null;
  refusal: string;
}[];
export const breakChallenges = challenges as {
  n: number;
  goal: string;
  how: string;
  expected: string;
  result: string;
}[];

/** The factory and its deployers (docs/results/factory), and the practice strategy it created first. */
export const factory = factoryData as {
  factory: string;
  deployers: { hyperevm: string; base: string };
  factoryCodeSha256: string;
  judgeCodeSha256: string;
  practice: { judge: string; leg: string; vault: string; manager: string; guardian: string; investor: string };
};

/** The daily drill's cycles on the practice strategy (docs/results/drill/runs.jsonl), newest first. */
export const drillRuns = drillData as {
  cycle: number | null;
  started: number;
  ended: number;
  ok: boolean;
  error: string | null;
  rescuer: string | null;
  trigger: string | null;
  payouts: { agent: string; yocto: string; reason: string }[];
  deliveries: { leg: "perp" | "spot"; amount: string; chain: string; tx: string }[];
  txs: { rearm: string | null; short: string | null };
}[];
