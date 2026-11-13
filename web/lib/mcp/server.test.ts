import { describe, expect, it } from "vitest";
import { handle } from "./server";

describe("the hosted MCP server", () => {
  it("negotiates the client's protocol version when it supports it", async () => {
    const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "klear" } } });
    const other = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    expect(other).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("lists only read-only tools; running a rescue is not one of them", async () => {
    const r = (await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual([
      "list_strategies",
      "inspect_strategy",
      "rescue_status",
      "how_to_rescue",
      "verify_sealed_receipt",
    ]);
    expect(r.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("answers no notification, and refuses what it does not know", async () => {
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({
      error: { code: -32601 },
    });
    expect(
      await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "start_rescue" } }),
    ).toMatchObject({
      error: { code: -32602 },
    });
  });

  it("rejects malformed arguments before any chain read", async () => {
    const r = await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "inspect_strategy", arguments: { judge: "../etc" } },
    });
    expect(r).toMatchObject({ result: { isError: true, content: [{ text: "judge must be a NEAR account id" }] } });
    const tx = await handle({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "verify_sealed_receipt", arguments: { tx: "nope", sender: "a.testnet" } },
    });
    expect(tx).toMatchObject({ result: { isError: true } });
  });
});
