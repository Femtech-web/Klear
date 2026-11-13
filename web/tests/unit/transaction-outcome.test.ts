import { describe, expect, it } from "vitest";
import { transactionOutcome } from "@/components/ui/transaction-outcome";

describe("wallet outcome presentation", () => {
  it("requires a successful execution result before claiming confirmation", () => {
    expect(transactionOutcome({ kind: "done", hash: "hash", outcome: { status: { SuccessValue: "" } } })).toBe(
      "confirmed",
    );
    expect(transactionOutcome({ kind: "done", hash: "hash", outcome: {} })).toBe("uncertain");
    expect(transactionOutcome({ kind: "done", hash: null, outcome: null })).toBe("uncertain");
  });
  it("does not present a transport timeout as a contract refusal", () => {
    expect(transactionOutcome({ kind: "refused", reason: "Failed to fetch" })).toBe("uncertain");
    expect(transactionOutcome({ kind: "refused", reason: "Request rejected" })).toBe("uncertain");
    expect(transactionOutcome({ kind: "refused", reason: "The operation was aborted" })).toBe("uncertain");
    expect(transactionOutcome({ kind: "refused", reason: "User rejected the request" })).toBe("cancelled");
    expect(transactionOutcome({ kind: "refused", reason: "not-investor" })).toBe("refused");
    expect(transactionOutcome({ kind: "refused", reason: "mandate:not-the-investor" })).toBe("refused");
    expect(transactionOutcome({ kind: "refused", reason: "ExecutionError: Smart contract panicked: no-trigger" })).toBe(
      "refused",
    );
  });
});
