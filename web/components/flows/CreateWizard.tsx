"use client";

import { ArrowRight, Check, ChevronDown } from "@/components/ui/icons";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccountMap } from "@/components/strategies/AccountMap";
import { rememberStrategy, SavedStrategy } from "@/components/strategies/SavedStrategy";
import { useStrategyDraft } from "@/components/strategies/StrategyDraft";
import { WorkflowNav } from "@/components/strategies/WorkflowNav";
import { TESTNET_ACCOUNT } from "@/lib/activation";
import { transactionOutcome } from "@/components/ui/transaction-outcome";
import { createStrategy, strategyConfig, validName, type MandateInput } from "@/lib/keel/calls";
import { evmAccount, hasEvmWallet } from "@/lib/wallet/evm";
import { ConnectNear } from "./ConnectNear";
import { Button, Result } from "./StrategyActions";
import { useNearAccount, useTx } from "./useNear";

/**
 * Create a strategy from the browser, as scripts/testnet/factory.sh does: every address is predicted
 * before anything is signed, the judge is created locked in one NEAR transaction, and its two EVM accounts
 * land at the predicted addresses.
 */

interface Prediction {
  judge: string;
  taken: boolean;
  controllers: { leg: string; vault: string };
  leg: string;
  vault: string;
  creationCostYocto: string;
  reviewKey: string;
}

const near = (yocto: bigint) => {
  const fraction = (yocto % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${yocto / 10n ** 24n}${fraction ? `.${fraction}` : ""} NEAR`;
};
const field = "h-11 min-w-0 w-full rounded-sm border border-line-strong bg-canvas px-3 text-base";

const noop = () => () => {};

export function CreateWizard({ factory, nonce }: { factory: string; nonce?: string }) {
  const me = useNearAccount();
  // The browser's EVM wallet, read without a hydration mismatch (the server has none).
  const evm = useSyncExternalStore(noop, hasEvmWallet, () => false);
  const { draft, setDraft, clear, stored, storageUnavailable } = useStrategyDraft(factory);
  const { name, label, investor, manager, pool, exitOnly, mandate } = draft;
  const m = exitOnly ? { ...mandate, exitOnSilence: false } : mandate;
  const setName = (name: string) => setDraft({ ...draft, name });
  const setLabel = (label: string) => setDraft({ ...draft, label });
  const setInvestor = (investor: string) => setDraft({ ...draft, investor });
  const setManager = (manager: string) => setDraft({ ...draft, manager });
  const setPool = (pool: string) => setDraft({ ...draft, pool });
  const setM = (next: MandateInput) =>
    setDraft({ ...draft, mandate: exitOnly ? { ...next, exitOnSilence: mandate.exitOnSilence } : next });
  const setExitOnly = (exitOnly: boolean) => setDraft({ ...draft, exitOnly });
  const [prediction, setPred] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const create = useTx();
  const outcome = transactionOutcome(create.state);
  const created = outcome === "confirmed";
  const locked = create.state.kind === "signing" || create.state.kind === "done" || outcome === "uncertain";
  const reviewKey = JSON.stringify([name, label, investor, manager, exitOnly, pool, m, me]);
  const pred = prediction && (locked || prediction.reviewKey === reviewKey) ? prediction : null;
  useEffect(() => {
    if ((created || outcome === "uncertain") && pred) rememberStrategy(pred.judge);
  }, [created, outcome, pred]);

  const poolYocto = /^\d{1,12}(\.\d{1,6})?$/.test(pool)
    ? BigInt(pool.split(".")[0]) * 10n ** 24n + BigInt((pool.split(".")[1] ?? "").padEnd(6, "0")) * 10n ** 18n
    : 0n;
  const ready =
    validName(name) &&
    (exitOnly || TESTNET_ACCOUNT.test(manager) || /^[a-f0-9]{64}$/.test(manager)) &&
    /^0x[0-9a-fA-F]{40}$/.test(investor) &&
    poolYocto >= 10n ** 23n &&
    Object.values(m).every(
      (value) =>
        typeof value !== "number" ||
        (Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1e8))),
    ) &&
    m.maxOrderEth > 0 &&
    m.maxLeverageX > 0 &&
    Number.isInteger(m.heartbeatMin) &&
    m.heartbeatMin > 0;

  const predict = async () => {
    setError(null);
    setPred(null);
    const q = new URLSearchParams({
      name,
      investor,
      maxOrderSz: String(Math.round(m.maxOrderEth * 1e8)),
      bandBp: String(m.bandBp),
      maxBasisBp: String(m.maxBasisBp),
    });
    setBusy("preview");
    try {
      const response = await fetch(`/api/keel/predict?${q}`, { cache: "no-store" });
      const j = await response.json();
      if (!response.ok || j.error) throw new Error(j.error ?? "Address preview unavailable");
      setPred({ ...j, reviewKey });
      if (j.taken) setError("This judge already exists. Inspect its live mandate and accounts before continuing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Address preview unavailable. Try again shortly.");
    } finally {
      setBusy(null);
    }
  };

  const config =
    pred && me
      ? strategyConfig({
          name,
          leg: pred.leg,
          vault: pred.vault,
          investor,
          investorAccount: me,
          manager: exitOnly ? undefined : manager || undefined,
          mandate: m,
        })
      : null;
  const deposit = pred ? BigInt(pred.creationCostYocto) + poolYocto : 0n;
  const num = (k: keyof MandateInput, label: string, step = "any") => (
    <label className="grid gap-1 text-sm">
      <span className="text-ink-2">{label}</span>
      <input
        type="number"
        step={step}
        value={m[k] as number}
        onChange={(e) => setM({ ...m, [k]: Number(e.target.value) })}
        className={field}
      />
    </label>
  );

  if (created && pred)
    return (
      <div>
        <WorkflowNav current="activate" />
        <h2 className="mt-6 text-h2">Your rules are locked.</h2>
        <p className="mt-3 max-w-measure text-ink-2">
          Continue with deployment, live verification, funding and your manager connection on this strategy’s own page.
          You can leave and return there at any time.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-ink-2">{pred.judge}</p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link
            href={`/strategies/${pred.judge}#setup-progress`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-canvas"
          >
            Continue to activation <ArrowRight size={16} />
          </Link>
          <SavedStrategy judge={pred.judge} />
        </div>
        <Result state={create.state} judge={pred.judge} />
      </div>
    );

  return (
    <div>
      <WorkflowNav current="setup" />
      <p className="mt-4 text-sm text-ink-2">
        {storageUnavailable
          ? "Browser storage is unavailable. Keep this page open until creation is confirmed."
          : "Your public setup draft is saved in this browser. Private trading instructions and wallet keys are never stored here."}
      </p>
      {stored && (
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            clear();
            setPred(null);
            setExitOnly(false);
          }}
          className="mb-5 inline-flex min-h-11 items-center text-xs font-semibold underline"
        >
          Start a fresh draft
        </button>
      )}
      <div className="grid divide-y divide-line">
        <Stage n={1} title="Connect your investor wallet" done={Boolean(me)}>
          <p className="m-0 mb-3 text-sm text-ink-2">
            This NEAR testnet account signs for creation, exit requests and new cycles.
          </p>
          <ConnectNear nonce={nonce} />
        </Stage>

        <Stage n={2} title="Set the rules and payout" done={Boolean(pred)}>
          <fieldset disabled={locked} className="min-w-0 border-0 p-0 disabled:opacity-70">
            <legend className="sr-only">Strategy mandate</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Strategy name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                  className={field}
                  placeholder="my-fund"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Display name in the registry</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value.slice(0, 80))}
                  className={field}
                  placeholder="ETH basis, AI-managed"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span id="payout-label" className="font-medium">
                  Your EVM payout address
                </span>
                <span className="flex gap-2">
                  <input
                    value={investor}
                    aria-labelledby="payout-label"
                    aria-describedby="payout-help"
                    onChange={(e) => setInvestor(e.target.value.trim())}
                    className={`${field} font-mono`}
                    placeholder="0x…"
                  />
                  {evm && (
                    <Button
                      onClick={() => void evmAccount().then(setInvestor, (e) => setError(String(e?.message ?? e)))}
                    >
                      Use my wallet
                    </Button>
                  )}
                </span>
                <span id="payout-help" className="text-xs text-ink-3">
                  Both accounts return funds here. The address is fixed once signed.
                </span>
              </label>
              <label className="grid gap-1 text-sm">
                <span id="manager-label" className="font-medium">
                  Manager’s NEAR account
                </span>
                <input
                  value={manager}
                  disabled={exitOnly}
                  aria-labelledby="manager-label"
                  aria-describedby="manager-help"
                  onChange={(e) => setManager(e.target.value.trim())}
                  className={`${field} font-mono`}
                  placeholder="agent.testnet"
                />
                <span id="manager-help" className="text-xs text-ink-3">
                  This account will be allowed to propose trades, never withdrawals. It is fixed when you create the
                  judge. Activation will guide the runner connection. In <Link href="/proof/sealed">sealed mode</Link>,
                  private instructions are read inside a TEE.
                </span>
              </label>
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={exitOnly}
                onChange={(e) => setExitOnly(e.target.checked)}
                className="mt-1"
              />
              <span>
                Create an exit-only setup without an AI manager. This choice is fixed and cannot be upgraded to AI
                trading later.
              </span>
            </label>
            <details className="group mt-4 rounded-sm border border-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                Trading limits and guardian rewards
                <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 border-t border-line p-3 md:grid-cols-2">
                {num("maxLeverageX", "Maximum leverage (x)")}
                {num("floorUsd", "Floor: exit below this value (USD)")}
                {num("maxOrderEth", "Largest single order (ETH)")}
                {num("heartbeatMin", "Manager silence allowed (minutes)", "1")}
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    checked={m.exitOnSilence}
                    disabled={exitOnly}
                    onChange={(e) => setM({ ...m, exitOnSilence: e.target.checked })}
                  />
                  <span>
                    If the manager goes silent for longer, anyone may rescue the strategy. The timer starts at creation.
                  </span>
                </label>
                {num("flattenRewardNear", "Reward for the Hyperliquid leg (NEAR)")}
                {num("spotRewardNear", "Reward for the Base leg (NEAR)")}
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-2">Reward pool to fund now (NEAR, at least 0.1)</span>
                  <input
                    value={pool}
                    onChange={(e) => setPool(e.target.value.trim())}
                    inputMode="decimal"
                    className={`${field} font-mono`}
                  />
                </label>
              </div>
            </details>
            <p className="mt-2 text-xs text-ink-3">
              {m.maxLeverageX}× leverage cap · ${m.floorUsd} equity floor ·{" "}
              {m.exitOnSilence ? `exit after ${m.heartbeatMin} minutes of silence` : "no exit on silence"}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={!ready || busy !== null} onClick={() => void predict()}>
                {busy === "preview" ? "Checking addresses…" : "Preview addresses"}
              </Button>
              <p className="text-xs text-ink-3">
                Choose a name, payout address and manager, or explicitly choose exit-only. Trading limits use the
                testnet defaults shown above.
              </p>
            </div>
          </fieldset>
        </Stage>

        {pred?.taken && (
          <div className="py-5">
            <Link
              href={`/strategies/${pred.judge}#setup-progress`}
              className="inline-flex min-h-11 items-center font-semibold underline"
            >
              Inspect the existing strategy <ArrowRight size={16} />
            </Link>
          </div>
        )}
        {pred && !pred.taken && (
          <Stage n={3} title="Review and lock the judge" done={created}>
            <AccountMap judge={pred.judge} leg={pred.leg} vault={pred.vault} payout={investor} predicted />
            <div className="mb-5 rounded-md border border-line-strong bg-surface p-4">
              <h3 className="text-lg">What this signature locks</h3>
              <p className="mt-2 text-sm text-ink-2">
                {m.maxLeverageX}× maximum leverage · ${m.floorUsd} equity floor · {m.maxOrderEth} ETH maximum order.
              </p>
              <p className="mt-2 text-sm text-ink-2">
                {m.exitOnSilence
                  ? `Rescue after ${m.heartbeatMin} minutes of manager silence.`
                  : "No automatic exit for manager silence."}{" "}
                Guardian rewards: {m.flattenRewardNear} NEAR for the Hyperliquid leg and {m.spotRewardNear} NEAR for
                Base, each after verified delivery.
              </p>
              <p className="mt-2 text-sm font-medium">
                The judge is created without access keys. Its mandate, manager and payout address cannot be edited
                later.
              </p>
            </div>
            <dl className="m-0 grid gap-2 text-sm">
              {[
                ["Judge", pred.judge],
                ["Hyperliquid account (KeelLeg)", pred.leg],
                ["Base vault (KeelVault)", pred.vault],
                ["Payout address", investor],
                ["Investor’s NEAR account", me ?? "Connect before signing"],
                ["Manager", exitOnly ? "None configured (exit-only)" : manager || "None configured"],
                ["Judge’s MPC controllers", `${pred.controllers.leg} · ${pred.controllers.vault}`],
                [
                  "You attach",
                  `${near(deposit)}: storage ${near(BigInt(pred.creationCostYocto))} + pool ${near(poolYocto)}`,
                ],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-0.5 sm:grid-cols-[240px_1fr]">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className={`m-0 font-mono text-[0.86rem] ${k === "You attach" ? "break-normal" : "break-all"}`}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {config && (
              <details className="mt-4 border-t border-line">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">
                  Full configuration sent to the judge
                </summary>
                <pre tabIndex={0} className="overflow-x-auto rounded-md bg-surface-2 p-4 font-mono text-xs leading-6">
                  {JSON.stringify(config, null, 2)}
                </pre>
              </details>
            )}
            <p className="mt-4 text-xs text-ink-2">
              Sign <code>create_strategy</code> on NEAR testnet. Attached NEAR covers storage and the guardian pool.
              Your wallet quotes gas separately. Trading capital and EVM deployment gas are funded separately after
              creation.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={!config || locked}
                onClick={() =>
                  config && void create.run(createStrategy(factory, name, config, label || name, deposit.toString()))
                }
              >
                {create.state.kind === "signing" ? "Waiting for your wallet…" : "Create the judge"}
              </Button>
              <Result state={create.state} judge={pred.judge} />
            </div>
          </Stage>
        )}

        {error && (
          <p role="alert" className="m-0 text-sm text-no">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Stage({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-5 first:pt-0 last:pb-0 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-4">
      <span
        className={`grid size-7 place-items-center rounded-full font-mono text-xs ${done ? "bg-accent-soft text-accent" : "border border-line-strong text-ink-3"}`}
        aria-hidden="true"
      >
        {done ? <Check size={15} /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="mb-3 mt-1 font-sans text-lg font-semibold">
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </h2>
        {children}
      </div>
    </section>
  );
}
