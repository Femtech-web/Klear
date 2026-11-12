import { accessKeyCount, codeHash, view } from "@/lib/chain/near";
import { addressCall, erc20Balance, SELECTORS } from "@/lib/chain/evm";
import { spotUsdc } from "@/lib/chain/hyperliquid";
import { config } from "@/lib/config";
import { deployment } from "@/lib/data/live";
import { parseStrategy, type Strategy } from "@/lib/keel/strategy";

const HYPEREVM_RPC = "https://rpc.hyperliquid-testnet.xyz/evm";

/** A live read that may fail: the site shows "unavailable" rather than a stale or invented value. */
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

async function read<T>(f: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface JudgeStatus {
  name: "ai" | "human";
  judge: string;
  keys: Read<number>;
  code: Read<string>;
  codeMatchesBuild: boolean;
  strategy: Read<Strategy>;
  legPayout: Read<string>;
  vaultPayout: Read<string>;
}

export async function judgeStatus(name: "ai" | "human"): Promise<JudgeStatus> {
  const d = deployment.strategies.find((s) => s.name === name)!;
  const [keys, code, strategy, legPayout, vaultPayout] = await Promise.all([
    read(() => accessKeyCount(d.judge)),
    read(() => codeHash(d.judge)),
    read(async () => parseStrategy(await view(d.judge, "get_strategy"))),
    read(() => addressCall(d.leg, SELECTORS.payout, HYPEREVM_RPC)),
    read(() => addressCall(d.vault, SELECTORS.payout, config.baseRpc)),
  ]);
  return { name, judge: d.judge, keys, code, codeMatchesBuild: code.ok && code.value === deployment.localBuildSha256, strategy, legPayout, vaultPayout };
}

/** What the investor's own addresses hold now: WETH on Base and USDC on HyperCore (testnet). */
export async function investorBalances() {
  const [weth, usdc] = await Promise.all([read(() => erc20Balance(deployment.weth, deployment.investor)), read(() => spotUsdc(deployment.investor))]);
  return { weth, usdc };
}
