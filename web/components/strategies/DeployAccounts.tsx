"use client";

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

export function DeployAccounts({ calls, judge }: { calls: DeploymentCall[]; judge: string }) {
  const wallet = useSyncExternalStore(subscribe, hasEvmWallet, () => false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { hash?: string; error?: string; uncertain?: boolean }>>({});
  return (
    <div>
      <p className="text-sm text-ink-2">
        These predicted addresses match the judge’s locked configuration and had no deployed code on this read. Deploy
        with an EVM wallet funded for testnet gas, then reload to run the six checks.
      </p>
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
                    setBusy(true);
                    void sendEvm(call.chain, call.to, call.data)
                      .then(
                        (hash) => setResults((s) => ({ ...s, [call.chain]: { hash } })),
                        (e: unknown) => {
                          const error = e instanceof Error ? e.message : String(e);
                          setResults((s) => ({
                            ...s,
                            [call.chain]: {
                              error,
                              uncertain: !/user (rejected|denied)|rejected by user|reverted:/i.test(error),
                            },
                          }));
                        },
                      )
                      .finally(() => setBusy(false));
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
      <a
        href={`/strategies/${judge}#verify-and-fund`}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline"
      >
        Reload and verify both accounts
      </a>
    </div>
  );
}
