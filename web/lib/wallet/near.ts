"use client";

import type { NearConnector } from "@hot-labs/near-connect";
import wallets from "@/lib/wallet/wallets.json";
import type { Tx } from "@/lib/keel/calls";

/**
 * The NEAR wallet, through NEAR Connect (the connector NEAR's docs recommend). Wallets run in sandboxed
 * iframes; the list is pinned to the four that support testnet (wallets.json, from NEAR Connect's own
 * manifest), and their RPC is FastNEAR's. The page's account is a tiny external store for React.
 */

export const NEAR_RPC_TESTNET = "https://test.rpc.fastnear.com";

let connector: NearConnector | null = null;
let account: string | null = null;
const listeners = new Set<() => void>();
const set = (next: string | null) => {
  account = next;
  listeners.forEach((l) => l());
};

async function get(nonce?: string): Promise<NearConnector> {
  const { NearConnector } = await import("@hot-labs/near-connect");
  if (connector) return connector;
  connector = new NearConnector({
    network: "testnet",
    manifest: structuredClone(wallets) as never,
    features: { testnet: true, signAndSendTransaction: true },
    autoConnect: false,
    providers: { testnet: [NEAR_RPC_TESTNET] },
    cspNonce: nonce,
    footerBranding: null,
  });
  connector.on("wallet:signIn", (e: { accounts: { accountId: string }[] }) =>
    set(testnetAccount(e.accounts[0]?.accountId)),
  );
  connector.on("wallet:signOut", () => set(null));
  // A wallet connected on an earlier visit.
  connector
    .wallet()
    .then(async (w) => set(testnetAccount((await w.getAccounts())[0]?.accountId)))
    .catch(() => {});
  return connector;
}

export const nearAccount = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  snapshot: () => account,
  server: () => null,
};

/** Restore an earlier session without opening anything. */
export const restore = (nonce?: string) => void get(nonce).catch(() => {});

function testnetAccount(id?: string): string | null {
  return id && (/^[a-z0-9_.-]+\.testnet$/.test(id) || /^[a-f0-9]{64}$/.test(id)) ? id : null;
}

export async function connectionOptions(nonce?: string) {
  const c = await get(nonce);
  await c.whenManifestLoaded;
  return c.availableWallets.map(({ manifest: { id, name } }) => ({ id, name }));
}

export async function connect(nonce: string | undefined, walletId: string): Promise<void> {
  const c = await get(nonce);
  const w = await c.connect({ walletId });
  const id = testnetAccount((await w.getAccounts())[0]?.accountId);
  if (!id) {
    await c.disconnect().catch(() => {});
    set(null);
    throw new Error("Select a NEAR testnet account in your wallet, then reconnect.");
  }
  set(id);
}

export async function disconnect(): Promise<void> {
  await (await get()).disconnect();
  set(null);
}

/** Sign and send one transaction with the connected wallet; resolves with the final outcome. */
export async function send(tx: Tx): Promise<unknown> {
  const w = await (await get()).wallet();
  return w.signAndSendTransaction(tx as never);
}
