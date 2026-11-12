import { isRecord } from "@/lib/chain/rpc";

/** The parts of a Keel judge's `get_strategy` the site shows, narrowed from its JSON. */

export type LegStatus = "open" | "delivered" | "empty" | "unverified";
export type Trigger = "investor" | "floor" | "manager-silent" | "repair-exhausted";
export type Mode = "active" | "repairing" | "repair-exhausted" | "flattening" | "flattened" | "frozen";

export interface Delivery {
  leg: "perp" | "spot";
  /** USDC (1e8 per dollar) for the perp leg, token wei for the spot leg. */
  amount: bigint;
  evidence: { chain: string; tx: string; logIndex: number };
}

export interface Payout {
  jobId: number;
  agent: string;
  yocto: bigint;
  reason: string;
}

export interface Strategy {
  mode: Mode;
  poolYocto: bigint;
  exitRequested: boolean;
  lastHeartbeat: number;
  manager: string | null;
  investorAccount: string | null;
  investor: string | null;
  policy: { maxLeverageBp: number; floorUsd6: number; heartbeatS: number; onSilence: string };
  rescue: { trigger: Trigger | null; perp: LegStatus; spot: LegStatus; deliveries: Delivery[] };
  payouts: Payout[];
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`strategy: ${what} is not a string`);
  return v;
};
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number") throw new Error(`strategy: ${what} is not a number`);
  return v;
};
const rec = (v: unknown, what: string): Record<string, unknown> => {
  if (!isRecord(v)) throw new Error(`strategy: ${what} is not an object`);
  return v;
};
const opt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseStrategy(raw: unknown): Strategy {
  const s = rec(raw, "root");
  const c = rec(s.config, "config");
  const p = rec(c.policy, "policy");
  const r = rec(s.rescue, "rescue");
  return {
    mode: str(s.mode, "mode") as Mode,
    poolYocto: BigInt(str(s.pool, "pool")),
    exitRequested: s.exit_requested === true,
    lastHeartbeat: num(s.last_heartbeat, "last_heartbeat"),
    manager: opt(c.manager),
    investorAccount: opt(c.investor_account),
    investor: opt(c.investor),
    policy: {
      maxLeverageBp: typeof p.max_leverage_bp === "number" ? p.max_leverage_bp : 0,
      floorUsd6: typeof p.equity_floor_usd6 === "number" ? p.equity_floor_usd6 : 0,
      heartbeatS: typeof p.heartbeat_s === "number" ? p.heartbeat_s : 0,
      onSilence: typeof p.on_silence === "string" ? p.on_silence : "nothing",
    },
    rescue: {
      trigger: (opt(r.trigger) as Trigger | null) ?? null,
      perp: str(r.perp, "rescue.perp") as LegStatus,
      spot: str(r.spot, "rescue.spot") as LegStatus,
      deliveries: (Array.isArray(r.deliveries) ? r.deliveries : []).map((d, i) => {
        const x = rec(d, `delivery ${i}`);
        const ev = Array.isArray(x.evidence) ? x.evidence : [];
        return {
          leg: str(x.leg, "delivery.leg") as Delivery["leg"],
          amount: BigInt(str(x.amount, "delivery.amount")),
          evidence: { chain: String(ev[0] ?? ""), tx: String(ev[1] ?? ""), logIndex: Number(ev[2] ?? 0) },
        };
      }),
    },
    payouts: (Array.isArray(s.payouts) ? s.payouts : []).map((x, i) => {
      const y = rec(x, `payout ${i}`);
      return { jobId: num(y.job_id, "payout.job_id"), agent: str(y.agent, "payout.agent"), yocto: BigInt(str(y.amount, "payout.amount")), reason: typeof y.reason === "string" ? y.reason : "" };
    }),
  };
}
