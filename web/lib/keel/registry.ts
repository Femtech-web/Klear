import { accessKeyCount, codeHash, view } from "@/lib/chain/near";
import { addressCall, SELECTORS } from "@/lib/chain/evm";
import { derivedAddress } from "@/lib/chain/mpc";
import { isRecord } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { factory } from "@/lib/data/live";
import { parseStrategy, type Mode, type Strategy } from "@/lib/keel/strategy";
import { read, type Read } from "@/lib/keel/live";

/** Strategy discovery: the factory's public registry and each judge's one-call `status` view (judge v3.1). */

const HYPEREVM_RPC = "https://rpc.hyperliquid-testnet.xyz/evm";
const PAGE = 100;

export interface Entry {
  judge: string;
  creator: string;
  investorAccount: string | null;
  label: string;
  /** Unix seconds (NEAR block time). */
  createdAt: number;
}

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

function parseEntry(raw: unknown): Entry {
  if (!isRecord(raw) || typeof raw.judge !== "string") throw new Error("registry: malformed entry");
  return {
    judge: raw.judge,
    creator: String(raw.creator),
    investorAccount: s(raw.investor_account),
    label: String(raw.label),
    createdAt: n(raw.created_at),
  };
}

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

/** Every strategy the factory created, oldest first. */
export async function entries(): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await view(factory.factory, "list_strategies", { from_index: from, limit: PAGE });
    if (!Array.isArray(page)) throw new Error("registry: not a list");
    out.push(...page.map(parseEntry));
    if (page.length < PAGE) return out;
  }
}

export interface Listed {
  entry: Entry;
  glance: Read<Glance>;
}

export async function registry(): Promise<Read<Listed[]>> {
  return read(async () => {
    const list = await entries();
    return Promise.all(
      list.map(async (entry) => ({
        entry,
        glance: await read(async () => parseGlance(await view(entry.judge, "status"))),
      })),
    );
  });
}

export interface Inspection {
  /** This judge's registry entry; null if the factory never created it. */
  entry: Read<Entry | null>;
  keys: Read<number>;
  code: Read<string>;
  /** The judge code the factory deploys, as the factory itself publishes it. */
  factoryJudgeCode: Read<string>;
  glance: Read<Glance>;
  strategy: Read<Strategy & { leg: string; vault: string }>;
  leg: Read<{ controller: string; payout: string }>;
  vault: Read<{ controller: string; payout: string }>;
  /** The keys only this judge can have signed (MPC-derived for its account): what each controller must be. */
  derived: Read<{ leg: string; vault: string }>;
}

/** Everything a guardian or an investor checks before trusting a strategy, read live. */
export async function inspect(judge: string): Promise<Inspection> {
  const [list, keys, code, factoryJudgeCode, glance, strategy, derived] = await Promise.all([
    read(entries),
    read(() => accessKeyCount(judge)),
    read(() => codeHash(judge)),
    read(async () => String(await view(factory.factory, "judge_code_hash"))),
    read(async () => parseGlance(await view(judge, "status"))),
    read(async () => {
      const raw = await view(judge, "get_strategy");
      const c = isRecord(raw) && isRecord(raw.config) ? raw.config : {};
      return { ...parseStrategy(raw), leg: String(c.leg), vault: String(c.spot_account) };
    }),
    read(async () => {
      const [leg, vault] = await Promise.all([
        derivedAddress(judge, "keel/1/hyperevm"),
        derivedAddress(judge, "keel/1/spot"),
      ]);
      return { leg, vault };
    }),
  ]);
  const pair = (address: string, rpc: string) =>
    read(async () => {
      const [controller, payout] = await Promise.all([
        addressCall(address, SELECTORS.controller, rpc),
        addressCall(address, SELECTORS.payout, rpc),
      ]);
      return { controller, payout };
    });
  const failed = { ok: false as const, error: strategy.ok ? "" : strategy.error };
  const [leg, vault] = strategy.ok
    ? await Promise.all([pair(strategy.value.leg, HYPEREVM_RPC), pair(strategy.value.vault, config.baseRpc)])
    : [failed, failed];
  const entry: Read<Entry | null> = list.ok
    ? { ok: true, value: list.value.find((e) => e.judge === judge) ?? null }
    : list;
  return { entry, keys, code, factoryJudgeCode, glance, strategy, leg, vault, derived };
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
