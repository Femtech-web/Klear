import type { TxState } from "@/components/flows/useNear";

export function transactionOutcome(
  state: TxState,
): "idle" | "signing" | "confirmed" | "cancelled" | "refused" | "uncertain" {
  if (state.kind === "idle" || state.kind === "signing") return state.kind;
  if (state.kind === "done") {
    const status = (state.outcome as { status?: { SuccessValue?: unknown } } | null)?.status;
    return status && typeof status.SuccessValue === "string" ? "confirmed" : "uncertain";
  }
  if (/user (rejected|denied|cancelled|canceled)|rejected by user|wallet.*(cancelled|canceled)/i.test(state.reason))
    return "cancelled";
  if (
    /Smart contract panicked|"Failure"|ExecutionError|ActionError|^mandate:|^(not-investor|not-manager|attempt-not-resolved|snapshot-not-settled|stale-evidence|not-settled|evidence-reused|no-trigger|job-taken|job-expired)(\b|:)/.test(
      state.reason,
    )
  )
    return "refused";
  return "uncertain";
}
