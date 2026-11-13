"use client";

/* eslint-disable @next/next/no-img-element -- wallet icons are local files or embedded in the manifest. */
import { useEffect, useId, useRef, useState } from "react";
import { connect, connectionOptions, disconnect, restore } from "@/lib/wallet/near";
import manifest from "@/lib/wallet/wallets.json";
import { ArrowRight, Cross } from "@/components/ui/icons";
import { useNearAccount } from "./useNear";

const DETAILS: Record<string, string> = {
  "nightly-wallet": "Browser extension",
  "near-cli": "Sign in from your terminal",
  "meteor-wallet": "Extension, web or mobile wallet",
  "intear-wallet": "Connect securely with Intear",
};

export function ConnectNear({ nonce }: { nonce?: string }) {
  const account = useNearAccount();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  useEffect(() => restore(nonce), [nonce]);

  const select = async (id: string) => {
    dialog.current?.close();
    setPending(true);
    setError(null);
    try {
      await connect(nonce, id);
    } catch (e) {
      const message = e instanceof Error ? e.message : typeof e === "string" ? e : "Check your wallet and try again.";
      if (message !== "Wallet closed" && message !== "User rejected") setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid justify-items-start gap-2">
      {account ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
          <span className="text-ink-3">Signed in as</span>
          <code className="font-mono break-all text-ink">{account}</code>
          <button
            type="button"
            onClick={() => {
              setError(null);
              disconnect().catch(() => setError("Could not disconnect. Try again."));
            }}
            className="min-h-9 cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
          >
            Disconnect
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-disabled={pending}
            onClick={() => {
              if (pending) return;
              setOptions(null);
              connectionOptions(nonce).then(setOptions, () => {
                setOptions([]);
                setError("Wallet list unavailable. Close and try again.");
              });
              setError(null);
              dialog.current?.showModal();
            }}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-ink hover:text-canvas aria-disabled:cursor-wait"
          >
            {pending ? "Waiting for your wallet…" : "Connect a NEAR testnet wallet"}
          </button>
          <dialog
            ref={dialog}
            aria-labelledby={title}
            aria-describedby={description}
            className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-lg border border-line-strong bg-surface p-5 text-ink shadow-lift backdrop:bg-rescue-panel/65"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id={title} className="text-xl">
                Connect a NEAR testnet wallet
              </h2>
              <form method="dialog">
                <button
                  aria-label="Close wallet picker"
                  className="grid size-9 cursor-pointer place-items-center rounded-sm text-ink-2 hover:bg-surface-2"
                >
                  <Cross size={18} />
                </button>
              </form>
            </div>
            <p id={description} className="mt-1 text-sm text-ink-2">
              Choose your wallet with a testnet account selected.
            </p>
            <ul className="mt-4 grid gap-2">
              {error && (
                <li className="py-3 text-sm text-no" role="alert">
                  {error}
                </li>
              )}
              {options === null && (
                <li role="status" className="py-3 text-sm text-ink-2">
                  Loading wallets…
                </li>
              )}
              {!error && options?.length === 0 && (
                <li className="py-3 text-sm text-ink-2">No compatible testnet wallet found.</li>
              )}
              {options?.map(({ id, name }) => {
                const wallet = manifest.wallets.find((w) => w.id === id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => void select(id)}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 hover:border-accent hover:bg-accent-soft"
                    >
                      <img
                        src={wallet?.icon ?? "/icon.svg"}
                        alt=""
                        width={32}
                        height={32}
                        className="size-8 shrink-0 rounded-sm"
                      />
                      <span className="flex-1 text-left">
                        <span className="block text-sm font-semibold">{name}</span>
                        <span className="block text-xs text-ink-2">{DETAILS[id] ?? "Detected testnet wallet"}</span>
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-accent" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </dialog>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-no">
          {error}
        </p>
      )}
    </div>
  );
}
