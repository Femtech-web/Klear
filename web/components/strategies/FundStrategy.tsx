"use client";

import { RefreshSetup } from "./RefreshSetup";
import { useState, useSyncExternalStore } from "react";
import { decimalUnits, type FundingPlan } from "@/lib/activation";
import { executeFunding } from "@/lib/wallet/activate";
import { evmAccount, hasEvmWallet } from "@/lib/wallet/evm";
import { Button } from "@/components/flows/StrategyActions";
import { TxLink } from "@/components/ui/Tx";

const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("klear-funding", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("klear-funding", listener);
  };
};

export function FundStrategy({
  judge,
  payout,
  leg,
  vault,
}: {
  judge: string;
  payout: string;
  leg: string;
  vault: string;
}) {
  const wallet = useSyncExternalStore(subscribe, hasEvmWallet, () => false);
  const [kind, setKind] = useState<"usdc" | "weth">("usdc");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState<FundingPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hashes, setHashes] = useState<string[]>([]);
  const key = `klear.funding.${judge}`;
  const pending = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const mark = (value: string) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event("klear-funding"));
  };
  const prepare = async () => {
    setBusy(true);
    setMessage("");
    setPlan(null);
    try {
      decimalUnits(amount, kind === "usdc" ? 6 : 18);
      const funder = await evmAccount();
      const response = await fetch("/api/keel/funding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase: "prepare", judge, kind, amount, funder }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error ?? "Funding checks unavailable.");
      if (
        result.destination?.toLowerCase() !== (kind === "usdc" ? leg : vault).toLowerCase() ||
        result.funder?.toLowerCase() !== payout.toLowerCase()
      )
        throw new Error("Configuration changed. Reload this strategy before funding.");
      setPlan(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review funding.");
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!plan || busy || pending) return;
    setBusy(true);
    setMessage("");
    setHashes([]);
    try {
      // Persist before opening the wallet: a reload must not silently offer the same transfer again.
      mark(`${plan.amount} ${plan.kind.toUpperCase()} · requested ${new Date().toISOString()}`);
      await executeFunding(plan, (text, hash) => {
        setMessage(text);
        if (hash) setHashes((current) => (current.includes(hash) ? current : [...current, hash]));
      });
      setPlan(null);
      setAmount("");
      if (plan.kind === "usdc") setKind("weth");
      mark("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Confirmation unavailable. Check your wallet history.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-line pt-5">
      <h3 className="text-lg">Add test funds</h3>
      <p className="mt-2 max-w-measure text-sm text-ink-2">
        Use the payout wallet <code className="break-all">{payout}</code>. USDC comes from its Hyperliquid testnet
        perpetual balance. WETH comes from Base Sepolia; any shortfall can be wrapped from test ETH in your wallet.
      </p>
      {pending ? (
        <div className="mt-4 rounded-md border border-line-strong p-4 text-sm">
          <p className="font-semibold">A funding request has already been started</p>
          <p className="mt-2 break-words text-ink-2">{pending}</p>
          <p className="mt-2 text-ink-2">
            Check wallet history and refresh this page for live balances. A confirmed wrap can leave WETH in your wallet
            even if the following transfer was cancelled.
          </p>
          <RefreshSetup className="cursor-pointer mt-2 inline-flex min-h-11 items-center font-semibold underline">
            Refresh balances and setup
          </RefreshSetup>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 underline">Make another funding request</summary>
            <p className="text-ink-2">
              Continue only after checking the previous request. A new request sends additional funds; it does not retry
              the old one.
            </p>
            <Button
              disabled={busy}
              onClick={() => {
                mark("");
                setPlan(null);
                setMessage("");
              }}
            >
              I checked history; start a new request
            </Button>
          </details>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-sm">
              Asset
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as "usdc" | "weth");
                  setPlan(null);
                }}
                disabled={busy}
                className="h-11 min-w-0 rounded-sm border border-line-strong bg-canvas px-3"
              >
                <option value="usdc">USDC · Hyperliquid testnet</option>
                <option value="weth">WETH · Base Sepolia</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Amount to send
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.trim());
                  setPlan(null);
                }}
                disabled={busy}
                className="h-11 min-w-0 rounded-sm border border-line-strong bg-canvas px-3"
              />
            </label>
            <Button disabled={busy || !amount || !wallet} onClick={() => void prepare()}>
              {busy ? "Checking…" : "Review funding"}
            </Button>
          </div>
          {!wallet && (
            <p className="mt-3 text-sm text-ink-2">
              Open this page in an EVM wallet browser or install an EVM wallet extension to fund here.
            </p>
          )}
          {plan && (
            <div className="mt-4 rounded-md border border-line-strong p-4 text-sm">
              <p className="font-semibold">
                Send {plan.amount} {plan.kind.toUpperCase()} on testnet
              </p>
              <p className="mt-2 break-all text-ink-2">To {plan.destination}</p>
              {plan.activationFee && (
                <p className="mt-2 text-ink-2">
                  Hyperliquid reports a new destination account. Its 1 USDC activation cost is deducted from this
                  transfer.
                </p>
              )}
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-2">
                {plan.action ? (
                  <li>
                    Approve one typed testnet USDC transfer. Klear relays that signature once; it receives no spending
                    key.
                  </li>
                ) : (
                  plan.transactions?.map((tx) => (
                    <li key={tx.label}>
                      {tx.label}
                      {tx.value ? " (wallet quotes the ETH amount and gas)" : ""}.
                    </li>
                  ))
                )}
              </ol>
              <p className="mt-3 text-ink-2">
                Wallet approvals remain yours. Funds return only to the payout address locked in the mandate.
              </p>
              <div className="mt-3">
                <Button disabled={busy} onClick={() => void send()}>
                  Approve funding in my wallet
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="mt-3 break-words text-sm text-ink-2">
          {message}
        </p>
      )}
      {hashes.map((hash) => (
        <p key={hash} className="mt-2 text-sm">
          <TxLink chain="base" id={hash} />
        </p>
      ))}
      <a
        href="https://app.hyperliquid-testnet.xyz/"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-11 items-center text-sm underline"
      >
        Get or inspect USDC on Hyperliquid testnet ↗
      </a>
    </div>
  );
}
