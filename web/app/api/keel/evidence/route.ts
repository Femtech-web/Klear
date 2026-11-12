import { NextResponse, type NextRequest } from "next/server";
import { view } from "@/lib/chain/near";
import { isRecord } from "@/lib/chain/rpc";
import { evidenceKey, receipt, recentLogs, TOPICS, word, type EvmLog } from "@/lib/chain/logs";

/**
 * What a guardian in a browser needs to attest next, found on the server (the browser talks only to this
 * site). Read-only: it signs nothing, holds no key, and answers only what anyone can read on chain.
 *
 *   ?judge=<account>&kind=snapshot   the newest KeelLeg snapshot under 200 s old that nobody has attested
 *   ?judge=<account>&kind=spot       the newest vault balance attested in the last hour (anyone may attest it)
 *   ?judge=<account>&kind=exit&nonce=<n>   the vault's Exited log for that exit, once finalized
 */

const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

async function accounts(judge: string): Promise<{ leg: string; vault: string }> {
  const s = await view(judge, "get_strategy");
  const c = isRecord(s) && isRecord(s.config) ? s.config : null;
  if (!c || typeof c.leg !== "string" || typeof c.spot_account !== "string") throw new Error("not a Keel judge");
  return { leg: c.leg, vault: c.spot_account };
}

const attested = async (judge: string, key: string) => (await view(judge, "get_attested", { key })) !== null;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const judge = q.get("judge") ?? "";
  const kind = q.get("kind");
  if (!ACCOUNT.test(judge)) return json({ error: "judge: not a NEAR account" }, 400);
  try {
    const { leg, vault } = await accounts(judge);
    const now = Date.now() / 1000;

    if (kind === "snapshot") {
      const logs = await recentLogs("hyperevm", leg, TOPICS.snapshot, 600);
      for (const log of logs.reverse()) {
        const age = now - Number(word(log, 12));
        if (age > 200) break;
        const key = evidenceKey("hyperevm", log);
        if (!(await attested(judge, key))) return json({ log, key, age: Math.round(age) });
      }
      return json({ waiting: "no fresh snapshot yet: the courier posts one every few minutes while a rescue is due" });
    }

    if (kind === "spot") {
      const logs = await recentLogs("base", vault, TOPICS.balance, 3600);
      for (const log of logs.reverse()) {
        const key = evidenceKey("base", log);
        if (await attested(judge, key)) return json({ key, age: Math.round(now - Number(word(log, 2))) });
      }
      return json({ waiting: "no attested vault balance in the last hour" });
    }

    if (kind === "exit") {
      const nonce = q.get("nonce");
      if (!nonce || !/^\d{1,19}$/.test(nonce)) return json({ error: "nonce: a vault exit nonce" }, 400);
      const topic = `0x${BigInt(nonce).toString(16).padStart(64, "0")}`;
      const seen = await recentLogs("base", vault, TOPICS.exited, 7200, { topics: [topic], head: "latest" });
      const tx = seen.at(-1)?.transactionHash;
      if (!tx) return json({ waiting: "the vault exit has not been relayed yet" });
      const final = await recentLogs("base", vault, TOPICS.exited, 7200, { topics: [topic] });
      const log: EvmLog | undefined = final.find((l) => l.transactionHash === tx);
      if (!log) {
        const r = await receipt("base", tx);
        return json({ tx, waiting: "relayed; Base finalizes a block about 25 minutes after it", block: r?.blockNumber ?? null });
      }
      return json({ tx, log, key: evidenceKey("base", log), attested: await attested(judge, evidenceKey("base", log)) });
    }

    return json({ error: "kind: snapshot, spot or exit" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, 502);
  }
}
