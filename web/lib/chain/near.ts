import { cache } from "react";
import { config } from "@/lib/config";
import { isRecord, postJson } from "@/lib/chain/rpc";

/** NEAR's view RPCs, read on the server. */

async function query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await postJson(config.nearRpc, {
    jsonrpc: "2.0",
    id: "keel-web",
    method: "query",
    params: { finality: "final", ...params },
  });
  if (!isRecord(r) || !isRecord(r.result)) {
    const err = isRecord(r) && isRecord(r.error) ? JSON.stringify(r.error).slice(0, 200) : "no result";
    throw new Error(`NEAR RPC: ${err}`);
  }
  return r.result;
}

// Each read is made once per request, however many checks on the page need it.
const viewOnce = cache(async (account: string, method: string, argsJson: string): Promise<unknown> => {
  const r = await query({
    request_type: "call_function",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(argsJson).toString("base64"),
  });
  if (!Array.isArray(r.result)) throw new Error(`${account}.${method}: no result bytes`);
  return JSON.parse(Buffer.from(r.result as number[]).toString("utf8"));
});

/** A contract view, decoded from its JSON bytes. */
export function view(account: string, method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return viewOnce(account, method, JSON.stringify(args));
}

/** How many access keys the account has: 0 means nobody can sign for it, including whoever deployed it. */
export const accessKeyCount = cache(async (account: string): Promise<number> => (await accessKeys(account)).length);

/** SHA-256 of the deployed wasm, comparable with a local `make judge` build. */
export const codeHash = cache(async (account: string): Promise<string> => {
  const r = await query({ request_type: "view_code", account_id: account });
  if (typeof r.code_base64 !== "string") throw new Error(`${account}: no code`);
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(r.code_base64, "base64"));
  return Buffer.from(digest).toString("hex");
});

export interface AccessKey {
  publicKey: string;
  /** null for a full-access key. */
  functionCall: { receiver: string; methods: string[] } | null;
}

/** Every access key on an account, with what each one may call. */
export const accessKeys = cache(async (account: string): Promise<AccessKey[]> => {
  const r = await query({ request_type: "view_access_key_list", account_id: account });
  if (!Array.isArray(r.keys)) throw new Error(`${account}: no key list`);
  return r.keys.map((k: { public_key: string; access_key: { permission: unknown } }) => {
    const p = k.access_key.permission;
    const fc =
      typeof p === "object" && p !== null && "FunctionCall" in p
        ? (p as { FunctionCall: { receiver_id: string; method_names: string[] } }).FunctionCall
        : null;
    return { publicKey: k.public_key, functionCall: fc && { receiver: fc.receiver_id, methods: fc.method_names } };
  });
});
