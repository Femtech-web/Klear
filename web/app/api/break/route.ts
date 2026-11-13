import { NextResponse } from "next/server";
import { accessKeyCount, view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";
import { functionCall } from "@/lib/chain/tx";
import { factory } from "@/lib/data/live";
import { ATTACKS, isAttack, type AttackId } from "@/lib/keel/attacks";

/** Try to break the practice strategy: one real testnet transaction from a stranger's account (KLEAR_STRANGER_*),
 * which the locked judge refuses. A refused call changes nothing on chain. */

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

// The stranger pays gas for every attempt, so a burst of clicks shares one transaction per attack.
const REUSE_MS = 20_000;
const last = new Map<AttackId, { at: number; body: Record<string, unknown> }>();

async function args(attack: AttackId, judge: string): Promise<[string, Record<string, unknown>]> {
  if (attack === "exit") return ["request_exit", {}];
  if (attack === "rules") return ["set_mandate", { max_leverage_bp: 1_000_000, equity_floor_usd6: 0 }];
  // The judge looks evidence up before it checks the caller, so the order points at evidence it has attested.
  const s = await view(judge, "get_strategy");
  const used = isRecord(s) && Array.isArray(s.used) ? (s.used as [string, string, number][]) : [];
  const key = (chain: string) => {
    const e = used.filter((u) => u[0] === chain).at(-1);
    return e ? `${e[0]}:${e[1]}:${e[2]}` : `${chain}:none`;
  };
  return [
    "propose_order",
    { perp: key("hyperevm"), spot: key("base"), is_buy: true, sz: 10_000_000_000, limit_px: 200_000_000_000 },
  ];
}

export async function POST(req: Request) {
  const account = process.env.KLEAR_STRANGER_ACCOUNT;
  const secret = process.env.KLEAR_STRANGER_KEY;
  if (!account || !secret) return json({ error: "live attempts are not configured on this deployment" }, 503);
  let attack: unknown;
  try {
    attack = ((await req.json()) as { attack?: unknown }).attack;
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  if (!isAttack(attack)) return json({ error: `attack: one of ${ATTACKS.map((a) => a.id).join(", ")}` }, 400);

  const seen = last.get(attack);
  if (seen && Date.now() - seen.at < REUSE_MS) return json({ ...seen.body, reused: true });

  const judge = factory.practice.judge;
  try {
    const [method, a] = await args(attack, judge);
    const sent = await functionCall(account, secret, judge, method, a, 50);
    const body = {
      attack,
      judge,
      from: account,
      method,
      tx: sent.hash,
      refused: sent.refusal !== null,
      reason: sent.refusal,
      accessKeys: attack === "rules" ? await accessKeyCount(judge) : undefined,
      at: new Date().toISOString(),
    };
    last.set(attack, { at: Date.now(), body });
    return json(body);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "send failed" }, 502);
  }
}
