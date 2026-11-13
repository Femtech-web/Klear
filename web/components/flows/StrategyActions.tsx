"use client";

import { useState } from "react";
import { TxLink } from "@/components/ui/Tx";
import { transactionOutcome } from "@/components/ui/transaction-outcome";
import { fundPool, rearm, requestExit, type Tx } from "@/lib/keel/calls";
import { ConnectNear } from "./ConnectNear";
import { useNearAccount, useTx, type TxState } from "./useNear";

/** What a signed-in account can do on a strategy, from the browser: the investor's exit and rearm, and
 * anyone's top-up of the reward pool. The judge decides; the page only asks the wallet to sign. */
export function StrategyActions({
  judge,
  investorAccount,
  mode,
  nonce,
  connect = true,
}: {
  judge: string;
  investorAccount: string | null;
  mode: string;
  nonce?: string;
  connect?: boolean;
}) {
  const account = useNearAccount();
  const isInvestor = account !== null && account === investorAccount;
  const canExit = ["active", "repairing", "repair-exhausted", "deleveraging"].includes(mode);
  return (
    <div className="grid gap-5">
      {connect && <ConnectNear nonce={nonce} />}
      {!account && (
        <p className="text-sm text-ink-2">
          Connect the investor’s NEAR account to request an exit or start a new cycle. Any connected account can add to
          the reward pool.
        </p>
      )}
      {account && (
        <div className="grid gap-4">
          {isInvestor ? (
            <>
              {mode === "flattened" ? (
                <Action
                  title="Start a new cycle"
                  text="The same rules and accounts, a new cycle. Verify and fund both accounts before rearming; run the manager and courier separately."
                  tx={rearm(judge)}
                  unavailable="Only after a completed rescue."
                  label="Rearm"
                />
              ) : (
                <Action
                  title="Request your exit"
                  text="Any time, for any reason: from now on any guardian may bring both legs home to your addresses."
                  tx={canExit ? requestExit(judge) : null}
                  unavailable={
                    mode === "unknown"
                      ? "Live state is unavailable. Reload the strategy before signing."
                      : "An exit cannot be requested in this state. Check the rescue progress."
                  }
                  label="Request exit"
                />
              )}
            </>
          ) : (
            <p className="m-0 text-sm text-ink-3">
              Only the investor&apos;s account ({investorAccount ?? "none"}) can exit or rearm this strategy. Connect
              that account to use these controls.
            </p>
          )}
          <FundPool judge={judge} />
        </div>
      )}
    </div>
  );
}

function Action({
  title,
  text,
  tx,
  unavailable,
  label,
}: {
  title: string;
  text: string;
  tx: Tx | null;
  unavailable: string;
  label: string;
}) {
  const { state, run } = useTx();
  const outcome = transactionOutcome(state);
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="m-0 font-medium">{title}</p>
      <p className="m-0 text-sm text-ink-2">{tx ? text : unavailable}</p>
      {tx && <SigningSummary tx={tx} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!tx || state.kind === "signing" || state.kind === "done" || outcome === "uncertain"}
          onClick={() => tx && void run(tx)}
        >
          {state.kind === "signing" ? "Waiting for your wallet…" : label}
        </Button>
        <Result state={state} judge={tx?.receiverId} />
      </div>
    </div>
  );
}

function FundPool({ judge }: { judge: string }) {
  const [near, setNear] = useState("0.1");
  const { state, run } = useTx();
  const blocked = state.kind === "signing" || state.kind === "done" || transactionOutcome(state) === "uncertain";
  const valid = /^\d+(\.\d{1,6})?$/.test(near) && Number(near) > 0 && Number(near) <= 10;
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="m-0 font-medium">Top up the reward pool</p>
      <p className="m-0 text-sm text-ink-2">
        Anyone may add NEAR to what this strategy pays its guardians. It cannot be taken back.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="sr-only">Amount in NEAR</span>
          <input
            value={near}
            disabled={blocked}
            onChange={(e) => setNear(e.target.value.trim())}
            inputMode="decimal"
            className="h-11 w-24 rounded-md border border-line-strong bg-surface px-3 font-mono tabular-nums"
            aria-invalid={!valid}
          />
          NEAR
        </label>
        <Button
          disabled={!valid || blocked}
          onClick={() => void run(fundPool(judge, (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString()))}
        >
          {state.kind === "signing" ? "Waiting for your wallet…" : "Add to the pool"}
        </Button>
        <Result state={state} judge={judge} />
      </div>
      <p className="text-xs text-ink-3">
        {valid
          ? `${near} NEAR will be attached to fund_pool on ${judge}.`
          : "Enter an amount greater than 0 and no more than 10 NEAR."}{" "}
        Your wallet quotes network gas separately.
      </p>
    </div>
  );
}

export function Button({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SigningSummary({ tx }: { tx: Tx }) {
  const deposit = tx.actions.reduce((sum, action) => sum + BigInt(action.params.deposit), 0n);
  return (
    <p className="break-all text-xs leading-relaxed text-ink-3">
      Sign on NEAR testnet · <code>{tx.actions.map((a) => a.params.methodName).join(", ")}</code> on{" "}
      <code>{tx.receiverId}</code> · attach {deposit === 1n ? "1 yoctoNEAR" : `${Number(deposit) / 1e24} NEAR`}. Network
      gas is quoted by your wallet.
    </p>
  );
}

export function Result({ state, judge }: { state: TxState; judge?: string }) {
  const outcome = transactionOutcome(state);
  if (outcome === "confirmed" && state.kind === "done")
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ok" role="status">
        NEAR transaction confirmed{state.hash && <TxLink chain="near" id={state.hash} />}
        {judge && (
          <a href={`/strategies/${judge}`} className="underline">
            Refresh strategy
          </a>
        )}
      </span>
    );
  if (state.kind === "refused" || outcome === "uncertain")
    return (
      <div className="grid min-w-0 gap-1 break-words text-sm text-ink-2" role="alert">
        <span className="font-medium">
          {outcome === "cancelled"
            ? "Wallet request cancelled"
            : outcome === "refused"
              ? "The transaction was refused"
              : "Confirmation unavailable"}
        </span>
        {outcome === "uncertain" && (
          <span>
            The wallet could not confirm the outcome. Check the strategy and your wallet’s transaction history before
            trying again.
          </span>
        )}
        {state.kind === "refused" && (
          <details>
            <summary className="cursor-pointer py-2 text-xs underline">Wallet details</summary>
            <span className="break-all text-xs">{state.reason}</span>
          </details>
        )}
        {judge && (
          <a href={`/strategies/${judge}`} className="inline-flex min-h-11 items-center underline">
            Check the live strategy
          </a>
        )}
      </div>
    );
  return null;
}
