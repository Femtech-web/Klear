"use client";

/** The browser's own EVM wallet (window.ethereum, EIP-1193), for deploying a strategy's two accounts. */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export const EVM_CHAINS = {
  hyperevm: {
    chainId: "0x3e6", // 998
    chainName: "Hyperliquid EVM Testnet",
    rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    blockExplorerUrls: ["https://testnet.purrsec.com"],
  },
  base: {
    chainId: "0x14a34", // 84532
    chainName: "Base Sepolia",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
} as const;

export type EvmChainName = keyof typeof EVM_CHAINS;

function provider(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No EVM wallet in this browser (MetaMask, Rabby, …).");
  return eth;
}

export const hasEvmWallet = () => typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);

export async function evmAccount(): Promise<string> {
  const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  return accounts[0];
}

async function onChain(chain: EvmChainName): Promise<void> {
  const c = EVM_CHAINS[chain];
  try {
    await provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: c.chainId }] });
  } catch (e) {
    // 4902: the wallet does not know the chain yet.
    if ((e as { code?: number }).code !== 4902) throw e;
    await provider().request({ method: "wallet_addEthereumChain", params: [c] });
  }
}

/** Send a transaction on `chain` from the wallet's account and wait for its receipt; returns the hash. */
export async function sendEvm(chain: EvmChainName, to: string, data: string): Promise<string> {
  await onChain(chain);
  const from = await evmAccount();
  const hash = (await provider().request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as string;
  for (let i = 0; i < 90; i++) {
    const r = (await provider().request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (r?.status === "0x1") return hash;
    if (r?.status === "0x0") throw new Error(`reverted: ${hash}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`no receipt after 3 minutes: ${hash}`);
}
