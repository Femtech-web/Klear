"use client";

import { ArrowRight, Check, ChevronDown } from "@/components/ui/icons";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { useState, useSyncExternalStore } from "react";
import { AccountMap } from "@/components/strategies/AccountMap";
import { SavedStrategy } from "@/components/strategies/SavedStrategy";
import { transactionOutcome } from "@/components/ui/transaction-outcome";
import { createStrategy, DEFAULT_MANDATE, strategyConfig, validName, type MandateInput } from "@/lib/keel/calls";
import { deployLeg, deployVault } from "@/lib/keel/abi";
import { evmAccount, hasEvmWallet, sendEvm } from "@/lib/wallet/evm";
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
  salt: string;
  controllers: { leg: string; vault: string };
  leg: string;
  vault: string;
  deployers: { hyperevm: string; base: string };
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
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [investor, setInvestor] = useState("");
  const [manager, setManager] = useState("");
  const [pool, setPool] = useState("1");
  const [m, setM] = useState<MandateInput>(DEFAULT_MANDATE);
  const [prediction, setPred] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<{ leg?: string; vault?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const create = useTx();
  const outcome = transactionOutcome(create.state);
  const created = outcome === "confirmed";
  const locked = create.state.kind === "signing" || create.state.kind === "done" || outcome === "uncertain";
  const reviewKey = JSON.stringify([name, label, investor, manager, pool, m, me]);
  const pred = prediction && (locked || prediction.reviewKey === reviewKey) ? prediction : null;
  const [uncertainDeploy, setUncertainDeploy] = useState<{ leg?: string; vault?: string }>({});

  const poolYocto = /^\d{1,12}(\.\d{1,6})?$/.test(pool)
    ? BigInt(pool.split(".")[0]) * 10n ** 24n + BigInt((pool.split(".")[1] ?? "").padEnd(6, "0")) * 10n ** 18n
    : 0n;
  const ready =
    validName(name) &&
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
          manager: manager || undefined,
          mandate: m,
        })
      : null;
  const deposit = pred ? BigInt(pred.creationCostYocto) + poolYocto : 0n;
  const legArgs = pred && {
    salt: pred.salt,
    controller: pred.controllers.leg,
    payout: investor,
    perp: m.perp,
    szDecimals: m.szDecimals,
    maxOrderSz: BigInt(Math.round(m.maxOrderEth * 1e8)),
    bandBp: m.bandBp,
    maxBasisBp: m.maxBasisBp,
  };

  const deploy = async (which: "leg" | "vault") => {
    if (!pred || !legArgs) return;
    setBusy(which);
    setError(null);
    try {
      const hash =
        which === "leg"
          ? await sendEvm("hyperevm", pred.deployers.hyperevm, deployLeg(legArgs))
          : await sendEvm("base", pred.deployers.base, deployVault(pred.salt, pred.controllers.vault, investor));
      setDeployed((d) => ({ ...d, [which]: hash }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/user (rejected|denied)|rejected by user|reverted:/i.test(message)) {
        setUncertainDeploy((d) => ({ ...d, [which]: message }));
      }
      setError(message);
    } finally {
      setBusy(null);
    }
  };

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

  return (
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
                  <Button onClick={() => void evmAccount().then(setInvestor, (e) => setError(String(e?.message ?? e)))}>
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
                Manager’s NEAR account (optional)
              </span>
              <input
                value={manager}
                aria-labelledby="manager-label"
                aria-describedby="manager-help"
                onChange={(e) => setManager(e.target.value.trim())}
                className={`${field} font-mono`}
                placeholder="agent.testnet"
              />
              <span id="manager-help" className="text-xs text-ink-3">
                Enter the account before signing if you plan to trade. Run the manager separately; in{" "}
                <Link href="/proof/sealed">sealed mode</Link> it decides inside a TEE and your strategy stays private.
              </span>
            </label>
          </div>
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
                  onChange={(e) => setM({ ...m, exitOnSilence: e.target.checked })}
                />
                <span>If the manager goes silent for longer, anyone may rescue the strategy</span>
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
            <p className="text-xs text-ink-3">Enter a valid strategy name and payout address to preview.</p>
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
              Guardian rewards: {m.flattenRewardNear} NEAR for the Hyperliquid leg and {m.spotRewardNear} NEAR for Base,
              each after verified delivery.
            </p>
            <p className="mt-2 text-sm font-medium">
              The judge is created without access keys. Its mandate, manager and payout address cannot be edited later.
            </p>
          </div>
          <dl className="m-0 grid gap-2 text-sm">
            {[
              ["Judge", pred.judge],
              ["Hyperliquid account (KeelLeg)", pred.leg],
              ["Base vault (KeelVault)", pred.vault],
              ["Payout address", investor],
              ["Investor’s NEAR account", me ?? "Connect before signing"],
              ["Manager", manager || "None configured"],
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
            Sign <code>create_strategy</code> on NEAR testnet. Attached NEAR covers storage and the guardian pool. Your
            wallet quotes gas separately. Trading capital and EVM deployment gas are funded separately after creation.
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

      {pred && created && legArgs && (
        <Stage n={4} title="Deploy the trading account and vault" done={Boolean(deployed.leg && deployed.vault)}>
          <p className="m-0 mb-3 text-sm text-ink-2">
            Use your EVM wallet with testnet HYPE and Base Sepolia ETH for gas, or deploy with Foundry.
          </p>
          {evm && (
            <div className="mb-3 flex flex-wrap gap-3">
              <Button
                disabled={busy !== null || Boolean(deployed.leg) || Boolean(uncertainDeploy.leg)}
                onClick={() => void deploy("leg")}
              >
                {deployed.leg
                  ? "KeelLeg deployed"
                  : busy === "leg"
                    ? "Deploying on HyperEVM…"
                    : "Deploy the KeelLeg (HyperEVM)"}
              </Button>
              <Button
                disabled={busy !== null || Boolean(deployed.vault) || Boolean(uncertainDeploy.vault)}
                onClick={() => void deploy("vault")}
              >
                {deployed.vault
                  ? "KeelVault deployed"
                  : busy === "vault"
                    ? "Deploying on Base…"
                    : "Deploy the KeelVault (Base Sepolia)"}
              </Button>
            </div>
          )}
          {(uncertainDeploy.leg || uncertainDeploy.vault) && (
            <div role="alert" className="mb-4 rounded-md border border-line-strong p-4 text-sm">
              <p className="font-semibold">Deployment confirmation unavailable</p>
              <p className="mt-2 text-ink-2">
                A transaction may already have been submitted. Check your EVM wallet history and the predicted accounts
                before sending another deployment.
              </p>
              <Link
                href={`/strategies/${pred.judge}#verify-and-fund`}
                className="mt-2 inline-flex min-h-11 items-center font-semibold underline"
              >
                Check deployed accounts <ArrowRight size={15} />
              </Link>
            </div>
          )}
          <SavedStrategy judge={pred.judge} />
          <details open={evm ? undefined : true} className="group border-t border-line">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Deploy with Foundry <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            </summary>
            <pre
              tabIndex={0}
              className="m-0 overflow-x-auto rounded-sm border border-line bg-surface-2 p-3 font-mono text-[0.8rem] leading-6"
            >
              {[
                "# with your key: --account <keystore> or --private-key",
                `cast send ${pred.deployers.hyperevm} ${deployLeg(legArgs)} --rpc-url https://rpc.hyperliquid-testnet.xyz/evm`,
                `cast send ${pred.deployers.base} ${deployVault(pred.salt, pred.controllers.vault, investor)} --rpc-url https://sepolia.base.org`,
              ].join("\n")}
            </pre>
          </details>
        </Stage>
      )}

      {pred && created && (
        <Stage n={5} title="Verify and fund the accounts" done={false}>
          <p className="m-0 text-sm text-ink-2">
            After both deployments, verify the accounts on the strategy page before sending testnet funds. Start your
            manager and relayer separately when you’re ready to trade, sealed if your strategy should stay private.
          </p>
          <Link
            href={`/strategies/${pred.judge}#verify-and-fund`}
            className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm font-semibold hover:text-accent"
          >
            Open verification and funding <ArrowRight size={16} />
          </Link>
        </Stage>
      )}

      {error && (
        <p role="alert" className="m-0 text-sm text-no">
          {error}
        </p>
      )}
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
