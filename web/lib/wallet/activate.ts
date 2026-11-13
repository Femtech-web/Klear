"use client";

import { EVM_CHAINS, evmAccount } from "./evm";
import { splitSignature, usdTypedData, type FundingPlan } from "@/lib/activation";

function provider() {
  const wallet = (
    window as unknown as { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } }
  ).ethereum;
  if (!wallet) throw new Error("Connect an EVM browser wallet to continue.");
  return wallet;
}

export async function executeFunding(plan: FundingPlan, update: (message: string, hash?: string) => void) {
  const wallet = provider();
  const chain = EVM_CHAINS[plan.kind === "usdc" ? "hyperevm" : "base"];
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await wallet.request({ method: "wallet_addEthereumChain", params: [chain] });
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainId }] });
  }
  const check = async () => {
    if ((await evmAccount()).toLowerCase() !== plan.funder.toLowerCase())
      throw new Error("Your wallet account changed. Review funding again.");
    if ((await wallet.request({ method: "eth_chainId" })) !== chain.chainId)
      throw new Error("Your wallet network changed. Review funding again.");
  };
  if (plan.kind === "usdc" && plan.action) {
    await check();
    update("Approve the test USDC transfer in your wallet.");
    const signature = await wallet.request({
      method: "eth_signTypedData_v4",
      params: [plan.funder, JSON.stringify(usdTypedData(plan.action))],
    });
    if (typeof signature !== "string") throw new Error("No signature returned by the wallet.");
    update("Submitting your signed transfer once…");
    const response = await fetch("/api/keel/funding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: "submit",
        judge: plan.judge,
        kind: plan.kind,
        funder: plan.funder,
        amount: plan.amount,
        time: plan.action.time,
        signature: splitSignature(signature),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.accepted) throw new Error(result.error ?? "Transfer confirmation unavailable.");
    update("Hyperliquid accepted the transfer. Refresh balances to check arrival.");
    return;
  }
  if (!plan.transactions?.length) throw new Error("Review the funding request again.");
  for (const tx of plan.transactions) {
    await check();
    update(tx.label);
    const hash = await wallet.request({
      method: "eth_sendTransaction",
      params: [{ from: plan.funder, to: tx.to, data: tx.data, ...(tx.value ? { value: tx.value } : {}) }],
    });
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash))
      throw new Error("Transaction confirmation unavailable.");
    update("Waiting for Base Sepolia confirmation…", hash);
    let confirmed = false;
    for (let i = 0; i < 60; i++) {
      const receipt = (await wallet.request({ method: "eth_getTransactionReceipt", params: [hash] })) as {
        status?: string;
      } | null;
      if (receipt?.status === "0x0") throw new Error(`Transaction reverted: ${hash}`);
      if (receipt?.status === "0x1") {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!confirmed) throw new Error(`Confirmation unavailable. Check your wallet history: ${hash}`);
    update(`${tx.label}: confirmed.`, hash);
  }
  update("Base transfer confirmed. Refresh balances to check arrival.");
}
