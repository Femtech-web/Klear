/** A JSON-RPC or JSON POST, never cached: a revalidating cache would show the first visitor after a quiet
 * hour that hour-old state, and a live page must not. Rate limits (public RPCs answer a burst of reads with
 * 429, as HTTP or as a JSON-RPC error) are retried twice with backoff; anything else fails at once. */
export async function postJson(url: string, body: unknown): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "keel-web/0.1" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const limited = res.status === 429 || res.status >= 500;
    const json: unknown = res.ok ? await res.json() : null;
    const rpcLimited = isRecord(json) && isRecord(json.error) && json.error.code === -429;
    if ((limited || rpcLimited) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * 3 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
    return json;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
