import { config } from "@/lib/config";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** An address's HyperCore spot USDC, from Hyperliquid's public info API. */
export async function spotUsdc(user: string): Promise<number> {
  const r = await postJson(config.hyperliquidInfo, { type: "spotClearinghouseState", user });
  if (!isRecord(r) || !Array.isArray(r.balances)) throw new Error("hyperliquid: no balances");
  const usdc = r.balances.find((b) => isRecord(b) && b.coin === "USDC");
  return isRecord(usdc) ? Number(usdc.total) : 0;
}
