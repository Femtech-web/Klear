import { block, receipt } from "@/lib/chain/logs";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import type { RunnerReport, RunnerStatus } from "./runner-protocol";
import { keccak_256 } from "@noble/hashes/sha3.js";

const queuedTopic =
  "0x" +
  Buffer.from(
    keccak_256(new TextEncoder().encode("OrderQueued(uint64,uint128,bool,uint64,uint64,bool,uint64)")),
  ).toString("hex");

async function checkHeartbeat(status: RunnerStatus): Promise<RunnerReport["checkIn"]> {
  if (!status.heartbeat) return { state: "pending" };
  try {
    const reply = await postJson(config.nearRpc, {
      jsonrpc: "2.0",
      id: "klear-heartbeat",
      method: "tx",
      params: { tx_hash: status.heartbeat, sender_account_id: status.manager, wait_until: "NONE" },
    });
    const r = isRecord(reply) && isRecord(reply.result) ? reply.result : null;
    if (!r) return { state: "unavailable" };
    const tx = isRecord(r.transaction) ? r.transaction : null;
    const actions = tx && Array.isArray(tx.actions) ? tx.actions : [];
    const fn = isRecord(actions[0]) ? actions[0].FunctionCall : null;
    if (
      (r.final_execution_status !== "FINAL" && r.final_execution_status !== "EXECUTED") ||
      !tx ||
      tx.hash !== status.heartbeat ||
      tx.signer_id !== status.manager ||
      tx.receiver_id !== status.judge ||
      actions.length !== 1 ||
      !isRecord(fn) ||
      fn.method_name !== "heartbeat" ||
      !isRecord(r.status) ||
      typeof r.status.SuccessValue !== "string"
    )
      return { state: "pending" };
    const outcome = isRecord(r.transaction_outcome) ? r.transaction_outcome : null;
    if (!outcome || typeof outcome.block_hash !== "string") return { state: "confirmed" };
    const b = await postJson(config.nearRpc, {
      jsonrpc: "2.0",
      id: "klear-heartbeat-block",
      method: "block",
      params: { block_id: outcome.block_hash },
    });
    const result = isRecord(b) && isRecord(b.result) ? b.result : null;
    const timestamp =
      result && isRecord(result.header) ? Number(result.header.timestamp_nanosec ?? result.header.timestamp) : NaN;
    return Number.isFinite(timestamp)
      ? { state: "confirmed", at: Math.floor(timestamp / 1e6) }
      : { state: "confirmed" };
  } catch {
    return { state: "unavailable" };
  }
}

async function checkMarket(order: RunnerStatus["order"], leg: string): Promise<RunnerReport["market"]> {
  if (!order) return { state: "waiting" };
  try {
    const result = await postJson("https://api.hyperliquid-testnet.xyz/info", {
      type: "orderStatus",
      user: leg,
      oid: order.cloid,
    });
    if (
      isRecord(result) &&
      result.status === "order" &&
      isRecord(result.order) &&
      isRecord(result.order.order) &&
      typeof result.order.order.cloid === "string" &&
      result.order.order.cloid.toLowerCase() === order.cloid.toLowerCase() &&
      typeof result.order.status === "string" &&
      /^[a-zA-Z]{1,64}$/.test(result.order.status)
    ) {
      return { state: "observed", outcome: result.order.status };
    }
    if (!isRecord(result) || result.status !== "unknownOid") return { state: "unavailable" };
    if (order.tx) {
      const [r, finalized] = await Promise.all([receipt("hyperevm", order.tx), block("hyperevm", "finalized")]);
      if (
        r &&
        r.blockNumber <= finalized.number &&
        r.logs.some(
          (log) =>
            log.address.toLowerCase() === leg.toLowerCase() &&
            log.topics[0] === queuedTopic &&
            log.data.slice(2, 66).toLowerCase() === order.cloid.slice(2).toLowerCase().padStart(64, "0"),
        )
      )
        return { state: "queued" };
    }
    return { state: "waiting" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function verifyRunnerReport(status: RunnerStatus, leg: string): Promise<RunnerReport> {
  const [checkIn, market] = await Promise.all([checkHeartbeat(status), checkMarket(status.order, leg)]);
  return { ...status, checkIn, market };
}
