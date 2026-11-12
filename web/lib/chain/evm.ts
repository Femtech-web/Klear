import { config } from "@/lib/config";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** `balanceOf(owner)` on an ERC-20, read on the server with eth_call (latest block). */
export async function erc20Balance(token: string, owner: string, rpc: string = config.baseRpc): Promise<bigint> {
  const data = "0x70a08231" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const r = await postJson(rpc, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data }, "latest"] });
  if (!isRecord(r) || typeof r.result !== "string") throw new Error("eth_call: no result");
  return BigInt(r.result === "0x" ? 0 : r.result);
}

/** A no-argument view returning an address (KeelLeg/KeelVault `payout()`, `controller()`). */
export async function addressCall(contract: string, selector: string, rpc: string): Promise<string> {
  const r = await postJson(rpc, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data: selector }, "latest"] });
  if (!isRecord(r) || typeof r.result !== "string" || r.result.length < 66) throw new Error("eth_call: no address");
  return "0x" + r.result.slice(-40);
}

export const SELECTORS = { payout: "0x63bd1d4a", controller: "0xf77c4791" } as const;
