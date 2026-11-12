import { config } from "@/lib/config";

/** A JSON-RPC or JSON POST, cached in the Data Cache for `config.revalidateSeconds`. */
export async function postJson(url: string, body: unknown, revalidate: number = config.revalidateSeconds): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "keel-web/0.1" },
    body: JSON.stringify(body),
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
