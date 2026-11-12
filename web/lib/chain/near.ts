import { config } from "@/lib/config";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** NEAR's view RPCs, read on the server. */

async function query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await postJson(config.nearRpc, { jsonrpc: "2.0", id: "keel-web", method: "query", params: { finality: "final", ...params } });
  if (!isRecord(r) || !isRecord(r.result)) {
    const err = isRecord(r) && isRecord(r.error) ? JSON.stringify(r.error).slice(0, 200) : "no result";
    throw new Error(`NEAR RPC: ${err}`);
  }
  return r.result;
}

/** A contract view, decoded from its JSON bytes. */
export async function view(account: string, method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const r = await query({
    request_type: "call_function",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  if (!Array.isArray(r.result)) throw new Error(`${account}.${method}: no result bytes`);
  return JSON.parse(Buffer.from(r.result as number[]).toString("utf8"));
}

/** How many access keys the account has: 0 means nobody can sign for it, including whoever deployed it. */
export async function accessKeyCount(account: string): Promise<number> {
  const r = await query({ request_type: "view_access_key_list", account_id: account });
  return Array.isArray(r.keys) ? r.keys.length : NaN;
}

/** SHA-256 of the deployed wasm, comparable with a local `make judge` build. */
export async function codeHash(account: string): Promise<string> {
  const r = await query({ request_type: "view_code", account_id: account });
  if (typeof r.code_base64 !== "string") throw new Error(`${account}: no code`);
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(r.code_base64, "base64"));
  return Buffer.from(digest).toString("hex");
}
