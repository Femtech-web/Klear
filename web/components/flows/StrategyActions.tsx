"use client";

import { useState } from "react";
import { TxLink } from "@/components/ui/Tx";
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
  const closed = mode === "flattened" || mode === "frozen";
  return (
    <div className="grid gap-5">
      {connect && <ConnectNear nonce={nonce} />}
      {account && (
        <div className="grid gap-4">
          {isInvestor ? (
            <>
              <Action
                title="Request your exit"
                text="Any time, for any reason: from now on any guardian may bring both legs home to your addresses."
                tx={closed ? null : requestExit(judge)}
                unavailable="The strategy is closed: rearm it first."
                label="Request exit"
              />
              <Action
                title="Rearm"
                text="After a rescue: the same rules and accounts, a new cycle. Fund the accounts again first."
                tx={mode === "flattened" ? rearm(judge) : null}
                unavailable="Only after a completed rescue."
                label="Rearm"
              />
            </>
          ) : (
            <p className="m-0 text-sm text-ink-3">
              Only the investor&apos;s account ({investorAccount ?? "none"}) can exit or rearm this strategy. The judge
              refuses anyone else, and you are welcome to try.
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
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="m-0 font-medium">{title}</p>
      <p className="m-0 text-sm text-ink-2">{tx ? text : unavailable}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!tx || state.kind === "signing"} onClick={() => tx && void run(tx)}>
          {state.kind === "signing" ? "Waiting for your wallet…" : label}
        </Button>
        <Result state={state} />
      </div>
    </div>
  );
}

function FundPool({ judge }: { judge: string }) {
  const [near, setNear] = useState("0.1");
  const { state, run } = useTx();
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
            onChange={(e) => setNear(e.target.value.trim())}
            inputMode="decimal"
            className="h-10 w-24 rounded-md border border-line-strong bg-surface px-3 font-mono tabular-nums"
            aria-invalid={!valid}
          />
          NEAR
        </label>
        <Button
          disabled={!valid || state.kind === "signing"}
          onClick={() => void run(fundPool(judge, (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString()))}
        >
          {state.kind === "signing" ? "Waiting for your wallet…" : "Add to the pool"}
        </Button>
        <Result state={state} />
      </div>
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
      className="inline-flex h-10 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors duration-300 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Result({ state }: { state: TxState }) {
  if (state.kind === "done")
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ok" role="status">
        Done{state.hash && <TxLink chain="near" id={state.hash} />}
      </span>
    );
  if (state.kind === "refused")
    return (
      <span className="text-sm text-no" role="alert">
        Refused: {state.reason}
      </span>
    );
  return null;
}
