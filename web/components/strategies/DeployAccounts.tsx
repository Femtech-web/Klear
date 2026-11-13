"use client";

import { RefreshSetup } from "./RefreshSetup";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/flows/StrategyActions";
import { TxLink } from "@/components/ui/Tx";
import { hasEvmWallet, sendEvm } from "@/lib/wallet/evm";

export interface DeploymentCall {
  chain: "hyperevm" | "base";
  to: string;
  data: string;
  address: string;
}
const subscribe = () => () => {};

export function DeployAccounts({ calls }: { calls: DeploymentCall[] }) {
  const wallet = useSyncExternalStore(subscribe, hasEvmWallet, () => false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { hash?: string; error?: string; uncertain?: boolean }>>({});
  const deploy = async (call: DeploymentCall) => {
    try {
      const hash = await sendEvm(call.chain, call.to, call.data);
      setResults((s) => ({ ...s, [call.chain]: { hash } }));
      return true;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setResults((s) => ({
        ...s,
        [call.chain]: { error, uncertain: !/user (rejected|denied)|rejected by user|reverted:/i.test(error) },
      }));
      return false;
    }
  };
  return (
    <div>
      <p className="text-sm text-ink-2">
        These predicted addresses match the judge’s locked configuration and had no deployed code on this read. Deploy
        with an EVM wallet funded for testnet gas, then reload to run the six checks.
      </p>
      {wallet && (
        <div className="mt-4">
          <Button
            disabled={
              busy ||
              calls.every((call) => Boolean(results[call.chain]?.hash)) ||
              calls.some((call) => results[call.chain]?.uncertain)
            }
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void (async () => {
                for (const call of calls) {
                  if (results[call.chain]?.hash) continue;
                  if (!(await deploy(call))) break;
                }
              })().finally(() => setBusy(false));
            }}
          >
            {busy ? "Approve each deployment in your wallet…" : "Deploy remaining accounts"}
          </Button>
          <p className="mt-2 text-xs text-ink-2">
            One wallet approval per chain. If a request fails or is cancelled, the sequence stops. Confirmed deployments
            are skipped.
          </p>
        </div>
      )}
      <ul className="mt-4 grid gap-4">
        {calls.map((call) => {
          const result = results[call.chain];
          return (
            <li key={call.chain} className="min-w-0 rounded-md border border-line p-4">
              <h4 className="text-base">
                {call.chain === "hyperevm" ? "HyperEVM trading account" : "Base Sepolia vault"}
              </h4>
              <p className="my-2 break-all font-mono text-xs text-ink-2">{call.address}</p>
              {wallet && (
                <Button
                  disabled={busy || Boolean(result?.hash || result?.uncertain)}
                  onClick={() => {
                    if (busy) return;
                    setBusy(true);
                    void deploy(call).finally(() => setBusy(false));
                  }}
                >
                  {result?.hash ? "Deployment confirmed" : busy ? "Waiting for wallet / chain…" : "Deploy this account"}
                </Button>
              )}
              {result?.hash && (
                <p className="mt-2 text-sm">
                  <TxLink chain={call.chain} id={result.hash} />
                </p>
              )}
              {result?.error && (
                <div role="alert" className="mt-3 text-sm text-ink-2">
                  <p>
                    {result.uncertain
                      ? "Confirmation unavailable. Check your wallet history and reload the strategy before submitting again."
                      : "The wallet request was cancelled or the deployment reverted."}
                  </p>
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer py-2 text-xs underline">Wallet details</summary>
                    <p className="break-all text-xs">{result.error}</p>
                  </details>
                </div>
              )}
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold underline">
                  Deploy with Foundry
                </summary>
                <pre
                  tabIndex={0}
                  className="overflow-x-auto rounded-sm bg-surface-2 p-3 font-mono text-xs"
                >{`cast send ${call.to} ${call.data} --account <your-keystore> --rpc-url ${call.chain === "base" ? "https://sepolia.base.org" : "https://rpc.hyperliquid-testnet.xyz/evm"}`}</pre>
              </details>
            </li>
          );
        })}
      </ul>
      <RefreshSetup className="cursor-pointer mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline">
        Reload and verify both accounts
      </RefreshSetup>
    </div>
  );
}
