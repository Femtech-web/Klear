import deployments from "@/data/deployments.json";
import moment from "@/data/moment.json";
import attacks from "@/data/attacks.json";
import challenges from "@/data/challenges.json";
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
  strategies: { name: "ai" | "human"; judge: string; leg: string; vault: string; controller: string; vaultController: string }[];
};

export const liveAttacks = attacks as { strategy: string; attempt: string; tx: string | null; where: string | null; refusal: string }[];
export const breakChallenges = challenges as { n: number; goal: string; how: string; expected: string; result: string }[];
