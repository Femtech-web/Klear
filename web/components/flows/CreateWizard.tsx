"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
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
}

const near = (yocto: bigint) => `${(Number(yocto / 10n ** 18n) / 1e6).toFixed(3)} NEAR`;
const field = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[0.95rem]";

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
  const [pred, setPred] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<{ leg?: string; vault?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const create = useTx();

  const poolYocto = /^\d+(\.\d{1,6})?$/.test(pool) ? BigInt(Math.round(Number(pool) * 1e6)) * 10n ** 18n : 0n;
  const ready = validName(name) && /^0x[0-9a-fA-F]{40}$/.test(investor) && poolYocto >= 10n ** 23n;

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
    const j = await (await fetch(`/api/keel/predict?${q}`, { cache: "no-store" })).json();
    if (j.error) return setError(j.error);
    if (j.taken) return setError(`${j.judge} already exists: pick another name.`);
    setPred(j);
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
      setError(e instanceof Error ? e.message : String(e));
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
    <div className="grid gap-8">
      <Stage n={1} title="Your NEAR account" done={Boolean(me)}>
        <p className="m-0 mb-3 text-sm text-ink-2">
          It becomes the investor&apos;s account: the only one that can request an exit or rearm the strategy.
        </p>
        <ConnectNear nonce={nonce} />
      </Stage>

      <Stage n={2} title="The strategy and its mandate" done={Boolean(pred)}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-ink-2">Name (the judge becomes &lt;name&gt;.{factory})</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.trim().toLowerCase())}
              className={field}
              placeholder="my-fund"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-ink-2">Label, shown in the registry</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 80))}
              className={field}
              placeholder="ETH basis, AI-managed"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-ink-2">Your EVM address: where both accounts can ever pay out</span>
            <span className="flex gap-2">
              <input
                value={investor}
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
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-ink-2">
              Manager&apos;s NEAR account (optional: an AI agent that may only propose orders)
            </span>
            <input
              value={manager}
              onChange={(e) => setManager(e.target.value.trim())}
              className={`${field} font-mono`}
              placeholder="agent.testnet"
            />
          </label>
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
        <div className="mt-4">
          <Button disabled={!ready} onClick={() => void predict()}>
            Predict its addresses
          </Button>
        </div>
      </Stage>

      {pred && (
        <Stage n={3} title="Create the judge, locked" done={create.state.kind === "done"}>
          <dl className="m-0 grid gap-2 text-sm">
            {[
              ["Judge", pred.judge],
              ["Hyperliquid account (KeelLeg)", pred.leg],
              ["Base vault (KeelVault)", pred.vault],
              ["Controlled only by the judge's keys", `${pred.controllers.leg} · ${pred.controllers.vault}`],
              [
                "You attach",
                `${near(deposit)}: storage ${near(BigInt(pred.creationCostYocto))} + pool ${near(poolYocto)}`,
              ],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5 sm:grid-cols-[240px_1fr]">
                <dt className="text-ink-3">{k}</dt>
                <dd className="m-0 break-all font-mono text-[0.86rem]">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={!config || create.state.kind === "signing" || create.state.kind === "done"}
              onClick={() =>
                config && void create.run(createStrategy(factory, name, config, label || name, deposit.toString()))
              }
            >
              {create.state.kind === "signing" ? "Waiting for your wallet…" : "Create the judge"}
            </Button>
            <Result state={create.state} />
          </div>
        </Stage>
      )}

      {pred && create.state.kind === "done" && legArgs && (
        <Stage n={4} title="Deploy its two accounts" done={Boolean(deployed.leg && deployed.vault)}>
          <p className="m-0 mb-3 text-sm text-ink-2">
            Anyone may deploy them; each lands at the predicted address only with exactly these controllers and this
            payout. With your EVM wallet (it needs a little HYPE on HyperEVM testnet and ETH on Base Sepolia), or with
            Foundry:
          </p>
          {evm && (
            <div className="mb-3 flex flex-wrap gap-3">
              <Button disabled={busy !== null || Boolean(deployed.leg)} onClick={() => void deploy("leg")}>
                {deployed.leg
                  ? "KeelLeg deployed"
                  : busy === "leg"
                    ? "Deploying on HyperEVM…"
                    : "Deploy the KeelLeg (HyperEVM)"}
              </Button>
              <Button disabled={busy !== null || Boolean(deployed.vault)} onClick={() => void deploy("vault")}>
                {deployed.vault
                  ? "KeelVault deployed"
                  : busy === "vault"
                    ? "Deploying on Base…"
                    : "Deploy the KeelVault (Base Sepolia)"}
              </Button>
            </div>
          )}
          <pre
            tabIndex={0}
            className="m-0 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[0.8rem] leading-6"
          >
            {[
              "# with your key: --account <keystore> or --private-key",
              `cast send ${pred.deployers.hyperevm} ${deployLeg(legArgs)} --rpc-url https://rpc.hyperliquid-testnet.xyz/evm`,
              `cast send ${pred.deployers.base} ${deployVault(pred.salt, pred.controllers.vault, investor)} --rpc-url https://sepolia.base.org`,
            ].join("\n")}
          </pre>
        </Stage>
      )}

      {pred && create.state.kind === "done" && (
        <Stage n={5} title="Check it, then fund it" done={false}>
          <p className="m-0 text-sm text-ink-2">
            The inspection page runs the six checks a guardian runs. Then send USDC to the KeelLeg on Hyperliquid
            testnet and WETH to the vault on Base Sepolia.
          </p>
          <Link
            href={`/strategies/${pred.judge}`}
            className="mt-3 inline-block text-sm font-medium text-accent no-underline"
          >
            Inspect {pred.judge}
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
    <section className="grid grid-cols-[32px_minmax(0,1fr)] gap-4">
      <span
        className={`grid size-8 place-items-center rounded-full font-mono text-sm ${done ? "bg-accent text-canvas" : "border border-line-strong text-ink-3"}`}
        aria-hidden="true"
      >
        {n}
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
