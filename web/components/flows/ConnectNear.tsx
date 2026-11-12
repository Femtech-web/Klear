"use client";

import { useEffect, useState } from "react";
import { connect, disconnect, restore } from "@/lib/wallet/near";
import { useNearAccount } from "./useNear";

/** Connect a NEAR testnet wallet. `nonce` is the page's CSP nonce, for the wallet's sandboxed scripts. */
export function ConnectNear({ nonce }: { nonce?: string }) {
  const account = useNearAccount();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => restore(nonce), [nonce]);

  if (account)
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">Signed in as</span>
        <code className="font-mono text-ink">{account}</code>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="cursor-pointer text-accent underline-offset-2 hover:underline"
        >
          disconnect
        </button>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          setError(null);
          connect(nonce).catch((e) => setError(e instanceof Error ? e.message : String(e)));
        }}
        className="inline-flex h-10 cursor-pointer items-center rounded-full bg-ink px-5 text-sm font-medium text-canvas shadow-soft transition duration-300 ease-calm hover:-translate-y-px"
      >
        Connect a NEAR testnet wallet
      </button>
      {error && (
        <span role="alert" className="text-sm text-no">
          {error}
        </span>
      )}
    </span>
  );
}
