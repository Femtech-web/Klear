import { config } from "@/lib/config";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** EVM logs a guardian attests (KeelLeg snapshots, vault balances and exits), read on the server. */

export type EvmChain = "hyperevm" | "base";

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed?: boolean;
}

export const TOPICS = {
  snapshot: "0xf690be071e71e6a54b2373f5f789bad23c206d9294aefa06dd73630a5146ee19",
  balance: "0x2bd3e38a1c6aed238c688414f6919db3a3533a99f0c51942438603c49641b8e6",
  exited: "0xd264510f2a581e9064c1562e54cad0ced0465fc04b03dd1566b8c46edfcca25d",
} as const;

const HYPEREVM = "https://rpc.hyperliquid-testnet.xyz/evm";
const RPC: Record<EvmChain, string> = { hyperevm: HYPEREVM, base: config.baseRpc };
// Log queries need wide block ranges (sepolia.base.org answers 200 blocks, and Base Sepolia makes five a second).
const LOGS: Record<EvmChain, { urls: string[]; step: number }> = {
  hyperevm: { urls: [HYPEREVM], step: 1000 },
  base: { urls: ["https://base-sepolia.gateway.tenderly.co", "https://base-sepolia-rpc.publicnode.com"], step: 20000 },
};

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await postJson(url, { jsonrpc: "2.0", id: 1, method, params });
  if (!isRecord(r) || !("result" in r)) throw new Error(`${method}: ${JSON.stringify(isRecord(r) ? r.error : r).slice(0, 160)}`);
  return r.result;
}

export async function block(chain: EvmChain, tag: "finalized" | "latest" | number): Promise<{ number: number; timestamp: number }> {
  const b = await rpc(RPC[chain], "eth_getBlockByNumber", [typeof tag === "number" ? `0x${tag.toString(16)}` : tag, false]);
  if (!isRecord(b)) throw new Error(`${chain}: no block ${tag}`);
  return { number: Number(b.number), timestamp: Number(b.timestamp) };
}

/** Logs of `address` with `topic0` from the last `seconds` up to `head`, oldest first. */
export async function recentLogs(
  chain: EvmChain,
  address: string,
  topic0: string,
  seconds: number,
  opts: { topics?: string[]; head?: "finalized" | "latest" } = {},
): Promise<EvmLog[]> {
  const to = await block(chain, opts.head ?? "finalized");
  const back = await block(chain, Math.max(0, to.number - 1000));
  const perSecond = (to.number - back.number) / Math.max(1, to.timestamp - back.timestamp);
  const start = Math.max(0, to.number - Math.ceil(seconds * perSecond) - 1);
  const { urls, step } = LOGS[chain];
  const out: EvmLog[] = [];
  for (let from = start; from <= to.number; from += step) {
    const params = [{ address, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${Math.min(from + step - 1, to.number).toString(16)}`, topics: [topic0, ...(opts.topics ?? [])] }];
    let got: unknown = null;
    for (const [i, url] of urls.entries()) {
      try {
        got = await rpc(url, "eth_getLogs", params);
        break;
      } catch (e) {
        if (i === urls.length - 1) throw e;
      }
    }
    if (Array.isArray(got)) out.push(...(got as EvmLog[]));
  }
  return out;
}

/** The judge's key for a log: "<chain>:<tx hash>:<log index>". */
export const evidenceKey = (chain: EvmChain, log: EvmLog) => `${chain}:${log.transactionHash.toLowerCase()}:${parseInt(log.logIndex, 16)}`;

/** The i-th 32-byte word of a log's data. */
export const word = (log: EvmLog, i: number) => BigInt(`0x${log.data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`);

export async function receipt(chain: EvmChain, tx: string): Promise<{ blockNumber: number; logs: EvmLog[] } | null> {
  const r = await rpc(RPC[chain], "eth_getTransactionReceipt", [tx]);
  return isRecord(r) ? { blockNumber: Number(r.blockNumber), logs: r.logs as EvmLog[] } : null;
}

/** `eth_call` returning raw hex. */
export async function ethCall(chain: EvmChain, to: string, data: string): Promise<string> {
  const r = await rpc(RPC[chain], "eth_call", [{ to, data }, "latest"]);
  if (typeof r !== "string") throw new Error("eth_call: no result");
  return r;
}
