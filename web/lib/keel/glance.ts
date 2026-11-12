import { isRecord } from "@/lib/chain/rpc";
import type { Mode } from "@/lib/keel/strategy";

/** A judge's one-call `status` view, and what it means for a guardian: pure, so the browser can use it too. */

export interface Glance {
  mode: Mode;
  exitRequested: boolean;
  silent: boolean;
  exitOnSilence: boolean;
  lastHeartbeat: number;
  heartbeatS: number;
  trigger: string | null;
  cycle: number;
  poolYocto: bigint;
  job: { id: number; kind: string; agent: string; expiresAt: number } | null;
  manager: string | null;
  floorUsd6: number;
}

/** Why a guardian may start a rescue now without further evidence; a floor breach needs attested evidence. */
export function rescueDue(g: Glance): "investor" | "manager-silent" | null {
  if (g.mode !== "active" && g.mode !== "repairing" && g.mode !== "repair-exhausted" && g.mode !== "deleveraging")
    return null;
  if (g.exitRequested) return "investor";
  if (g.silent && g.exitOnSilence) return "manager-silent";
  return null;
}

const s = (v: unknown) => (typeof v === "string" ? v : null);
const n = (v: unknown) => (typeof v === "number" ? v : 0);

export function parseGlance(raw: unknown): Glance {
  if (!isRecord(raw) || typeof raw.mode !== "string") throw new Error("status: malformed");
  const j = isRecord(raw.job) ? raw.job : null;
  return {
    mode: raw.mode as Mode,
    exitRequested: raw.exit_requested === true,
    silent: raw.silent === true,
    exitOnSilence: raw.exit_on_silence === true,
    lastHeartbeat: n(raw.last_heartbeat),
    heartbeatS: n(raw.heartbeat_s),
    trigger: s(raw.trigger),
    cycle: n(raw.cycle),
    poolYocto: BigInt(s(raw.pool) ?? "0"),
    job: j && { id: n(j.id), kind: String(j.kind), agent: String(j.agent), expiresAt: n(j.expires_at) },
    manager: s(raw.manager),
    floorUsd6: n(raw.floor_usd6),
  };
}

export type Phase = "watching" | "rescue-due" | "rescuing" | "deleveraging" | "repairing" | "rescued" | "frozen";

/** One word for where a strategy is, as a guardian scanning the registry needs it. */
export function phase(g: Glance): Phase {
  if (g.mode === "frozen") return "frozen";
  if (g.mode === "flattened") return "rescued";
  if (g.mode === "flattening") return "rescuing";
  if (g.mode === "deleveraging") return "deleveraging";
  if (rescueDue(g)) return "rescue-due";
  if (g.mode === "repairing") return "repairing";
  return "watching";
}
