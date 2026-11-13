"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/primitives";
import { TxLink } from "@/components/ui/Tx";
import { ATTACKS, type AttackId } from "@/lib/keel/attacks";

/**
 * Live attempts to break the practice strategy, with no wallet: the server sends each one from a stranger's testnet
 * account and shows what the locked judge did with it.
 */

type Result =
  | { state: "sending" }
  | { state: "error"; error: string }
  | {
      state: "done";
      tx: string;
      refused: boolean;
      reason: string | null;
      accessKeys?: number;
      reused?: boolean;
    };

export function BreakIt() {
  const [results, setResults] = useState<Partial<Record<AttackId, Result>>>({});

  async function run(id: AttackId) {
    setResults((r) => ({ ...r, [id]: { state: "sending" } }));
    try {
      const res = await fetch("/api/break", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attack: id }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      setResults((r) => ({
        ...r,
        [id]: {
          state: "done",
          tx: String(body.tx),
          refused: body.refused === true,
          reason: typeof body.reason === "string" ? body.reason : null,
          accessKeys: typeof body.accessKeys === "number" ? body.accessKeys : undefined,
          reused: body.reused === true,
        },
      }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { state: "error", error: e instanceof Error ? e.message : "failed" } }));
    }
  }

  return (
    <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
      {ATTACKS.map((a) => {
        const r = results[a.id];
        return (
          <li key={a.id} className="flex flex-col rounded-lg border border-line bg-surface p-5">
            <h3 className="text-lg">{a.title}</h3>
            <p className="mt-1.5 text-sm text-ink-2">{a.tries}</p>
            <div className="mt-4">
              <button
                type="button"
                aria-label={`Try it: ${a.title}`}
                disabled={r?.state === "sending"}
                onClick={() => run(a.id)}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {r?.state === "sending" ? "Sending to testnet…" : "Try it"}
              </button>
            </div>
            <div aria-live="polite" className="mt-4 text-sm">
              {r?.state === "error" && <p className="m-0 text-ink-2">Could not send it: {r.error}</p>}
              {r?.state === "done" && (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={r.refused ? "ok" : "no"} mark={r.refused ? "check" : "cross"}>
                      {r.refused ? "Refused on chain" : "Accepted"}
                    </Pill>
                    <TxLink chain="near" id={r.tx} />
                  </div>
                  {r.reason && (
                    <p className="m-0 text-ink-2">
                      Reason: <code>{r.reason}</code>
                    </p>
                  )}
                  {r.accessKeys !== undefined && (
                    <p className="m-0 text-ink-2">The judge has {r.accessKeys} access keys, read just now.</p>
                  )}
                  <p className="m-0 text-ink-3">
                    {a.why}
                    {r.reused ? " (Someone tried this seconds ago; this is that transaction.)" : ""}
                  </p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
