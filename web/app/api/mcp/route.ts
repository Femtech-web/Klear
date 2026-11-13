import { handle } from "@/lib/mcp/server";

/** Klear's hosted MCP server (Streamable HTTP, JSON responses): `claude mcp add --transport http klear <site>/api/mcp`. */

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter((r) => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body as Parameters<typeof handle>[0]);
  return out ? json(out) : new Response(null, { status: 202 });
}

// No server-initiated stream, and no sessions to end.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}

export const DELETE = GET;
