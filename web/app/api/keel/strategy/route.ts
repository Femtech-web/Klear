import { NextResponse, type NextRequest } from "next/server";
import { view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";

/** A strategy's rescue state for the browser's guardian and investor flows (read-only; polled). */

const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: NextRequest) {
  const judge = request.nextUrl.searchParams.get("judge") ?? "";
  if (!ACCOUNT.test(judge)) return json({ error: "judge: not a NEAR account" }, 400);
  try {
    const [s, status] = await Promise.all([view(judge, "get_strategy"), view(judge, "status")]);
    if (!isRecord(s) || !isRecord(s.rescue) || !isRecord(status)) return json({ error: "not a Keel judge" }, 404);
    const r = s.rescue;
    const job = isRecord(s.job) ? s.job : null;
    const attempt = job && isRecord(job.attempt) && isRecord(job.attempt.order) ? job.attempt.order : null;
    return json({
      status,
      job: job && {
        id: job.id,
        kind: job.kind,
        agent: job.agent,
        expiresAt: job.expires_at,
        orderNonce: attempt?.nonce ?? null,
      },
      rescue: {
        trigger: r.trigger ?? null,
        agent: r.agent ?? null,
        perp: r.perp,
        spot: r.spot,
        sweepNonce: isRecord(r.sweep) ? r.sweep.nonce : null,
        exitNonce: isRecord(r.exit) ? r.exit.nonce : null,
      },
      payouts: Array.isArray(s.payouts) ? s.payouts : [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, 502);
  }
}
