"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { failure, type Tx } from "@/lib/keel/calls";
import { nearAccount, send } from "@/lib/wallet/near";

/** The connected NEAR account (null when none). */
export const useNearAccount = () =>
  useSyncExternalStore(nearAccount.subscribe, nearAccount.snapshot, nearAccount.server);

export type TxState =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "done"; hash: string | null; outcome: unknown }
  | { kind: "refused"; reason: string };

/** Sign one transaction and keep its result: the hash, or the judge's refusal in its own words. */
export function useTx() {
  const [state, setState] = useState<TxState>({ kind: "idle" });
  const run = useCallback(async (tx: Tx): Promise<TxState> => {
    setState({ kind: "signing" });
    let next: TxState;
    try {
      const outcome = await send(tx);
      const refused = failure(outcome);
      const hash = (outcome as { transaction?: { hash?: string } })?.transaction?.hash ?? null;
      next = refused ? { kind: "refused", reason: refused } : { kind: "done", hash, outcome };
    } catch (e) {
      next = { kind: "refused", reason: failure(e) ?? (e instanceof Error ? e.message : String(e)) };
    }
    setState(next);
    return next;
  }, []);
  return { state, run, reset: () => setState({ kind: "idle" }) };
}

/** The JSON a judge method returned, from a successful outcome (open_flatten and settle return their outcome). */
export function returned(outcome: unknown): Record<string, unknown> | null {
  const v = (outcome as { status?: { SuccessValue?: string } })?.status?.SuccessValue;
  if (!v) return null;
  try {
    return JSON.parse(atob(v));
  } catch {
    return null;
  }
}
