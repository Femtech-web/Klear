import { view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";
import { deployment } from "@/lib/data/live";
import { allLocked, lockedContracts } from "@/lib/keel/proof";
import { read, type Read } from "@/lib/keel/live";
import { entries, parseGlance, phase } from "@/lib/keel/registry";

/** Klear right now, read from NEAR testnet on each visit: what every judge has paid, and what is open. */

export interface Pulse {
  /** Rescues paid on proven arrival: distinct jobs with a Hyperliquid or Base payout. */
  rescues: number;
  paidYocto: bigint;
  /** Strategies whose rescue anyone may start now. */
  open: { judge: string; label: string }[];
  locked: Read<{ count: number; all: boolean }>;
  at: number;
}

/** Every payout one judge made, as the judge records it. */
export function tally(payouts: unknown[]): { jobs: Set<number>; yocto: bigint } {
  const jobs = new Set<number>();
  let yocto = 0n;
  for (const p of payouts) {
    if (!isRecord(p) || typeof p.amount !== "string") continue;
    yocto += BigInt(p.amount);
    if ((p.reason === "perp" || p.reason === "spot") && typeof p.job_id === "number") jobs.add(p.job_id);
  }
  return { jobs, yocto };
}

export async function pulse(): Promise<Read<Pulse>> {
  return read(async () => {
    const listed = await entries();
    const judges = [...deployment.strategies.map((s) => ({ judge: s.judge, label: s.name })), ...listed];
    const [states, locked] = await Promise.all([
      Promise.all(
        judges.map(async ({ judge, label }) => {
          // The two first live-run judges (v3) predate the `status` view; their runs are over.
          const [s, status] = await Promise.all([view(judge, "get_strategy"), read(() => view(judge, "status"))]);
          return { judge, label, s, status };
        }),
      ),
      lockedContracts(),
    ]);
    let rescues = 0;
    let paidYocto = 0n;
    const open: Pulse["open"] = [];
    for (const { judge, label, s, status } of states) {
      const t = tally(isRecord(s) && Array.isArray(s.payouts) ? s.payouts : []);
      rescues += t.jobs.size;
      paidYocto += t.yocto;
      if (status.ok && phase(parseGlance(status.value)) === "rescue-due") open.push({ judge, label });
    }
    const all = allLocked(locked);
    return {
      rescues,
      paidYocto,
      open,
      locked: all.ok ? { ok: true, value: { count: locked.length, all: all.value } } : all,
      at: Date.now(),
    };
  });
}
