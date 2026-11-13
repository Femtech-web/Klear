import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyRunnerReport } from "@/lib/keel/runner-evidence";
import { postJson } from "@/lib/chain/rpc";
import { view } from "@/lib/chain/near";
import { inspect, trustChecks } from "@/lib/keel/registry";
import { expectedAccounts } from "@/lib/keel/activation-accounts";
import { contactRunner } from "@/lib/keel/runner-connection";
import { POST } from "@/app/api/keel/manager/[judge]/route";
import { runnerOrigin, type RunnerStatus } from "@/lib/keel/runner-protocol";

vi.mock("@/lib/chain/rpc", async (get) => ({ ...(await get<object>()), postJson: vi.fn() }));
vi.mock("@/lib/chain/near", () => ({ view: vi.fn() }));
vi.mock("@/lib/keel/registry", () => ({ inspect: vi.fn(), trustChecks: vi.fn() }));
vi.mock("@/lib/keel/activation-accounts", () => ({ expectedAccounts: vi.fn() }));
vi.mock("@/lib/keel/runner-connection", async (get) => ({ ...(await get<object>()), contactRunner: vi.fn() }));
const judge = "strategy.testnet";
const manager = "manager.testnet";
const leg = `0x${"1".repeat(40)}`;
const cloid = `0x${"a".repeat(32)}`;
const heartbeat = "1".repeat(44);
const sample: RunnerStatus = {
  judge,
  manager,
  phase: "running",
  courier: true,
  profile: "sealed",
  heartbeat,
  order: { cloid, tx: null },
  problem: null,
};

beforeEach(() => vi.resetAllMocks());

it("only accepts canonical HTTPS origins on the supported tunnel services", () => {
  expect(runnerOrigin("https://example.trycloudflare.com")).toBe("https://example.trycloudflare.com");
  expect(runnerOrigin("https://runner.tailnet.ts.net/")).toBe("https://runner.tailnet.ts.net");
  for (const input of [
    "http://127.0.0.1",
    "https://169.254.169.254",
    "https://example.trycloudflare.com.evil.org",
    "https://example.trycloudflare.com@evil.org",
    "https://example.trycloudflare.com/test",
    "https://example.trycloudflare.com:8443",
  ])
    expect(() => runnerOrigin(input), input).toThrow();
});

it("independently confirms the heartbeat and reads the exact client order on Hyperliquid", async () => {
  vi.mocked(postJson).mockImplementation(async (_url, query) => {
    const rpc = query as { method?: string; params?: object; oid?: string; user?: string };
    if (rpc.method === "tx")
      return {
        result: {
          final_execution_status: "FINAL",
          status: { SuccessValue: "" },
          transaction: {
            hash: heartbeat,
            signer_id: manager,
            receiver_id: judge,
            actions: [{ FunctionCall: { method_name: "heartbeat" } }],
          },
          transaction_outcome: { block_hash: "block" },
        },
      };
    if (rpc.method === "block") return { result: { header: { timestamp_nanosec: "1700000000000000000" } } };
    expect(rpc).toMatchObject({ user: leg, oid: cloid });
    return { status: "order", order: { order: { cloid }, status: "filled" } };
  });
  const result = await verifyRunnerReport(sample, leg);
  expect(result.checkIn).toEqual({ state: "confirmed", at: 1700000000000 });
  expect(result.market).toEqual({ state: "observed", outcome: "filled" });
});

it("does not turn a different transaction or exchange lookup into evidence", async () => {
  vi.mocked(postJson).mockImplementation(async (_url, query) =>
    (query as { method?: string }).method === "tx"
      ? {
          result: {
            final_execution_status: "FINAL",
            status: { SuccessValue: "" },
            transaction: {
              hash: heartbeat,
              signer_id: manager,
              receiver_id: "someone.testnet",
              actions: [{ FunctionCall: { method_name: "heartbeat" } }],
            },
          },
        }
      : { status: "order", order: { order: { cloid: `0x${"b".repeat(32)}` }, status: "filled" } },
  );
  const result = await verifyRunnerReport(sample, leg);
  expect(result.checkIn.state).toBe("pending");
  expect(result.market.state).toBe("unavailable");
});

it("rejects cross-origin starts and refuses a start during rescue before contacting the runner", async () => {
  const endpoint = "https://example.trycloudflare.com";
  const payload = { endpoint, action: "start", token: "a".repeat(64) };
  const params = { params: Promise.resolve({ judge }) };
  const request = (origin: string) =>
    new NextRequest(`https://klear.example/api/keel/manager/${judge}`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(payload),
    });
  expect((await POST(request("https://untrusted.example"), params)).status).toBe(403);
  vi.mocked(view).mockResolvedValue({
    config: { manager, leg, spot_account: leg, chain_id: 998, spot_chain_id: 84532 },
  });
  vi.mocked(inspect).mockResolvedValue({
    derived: { ok: true, value: { leg, vault: leg } },
    glance: { ok: true, value: { mode: "flattening" } },
  } as never);
  vi.mocked(trustChecks).mockReturnValue([{ check: "verified", pass: true }]);
  expect((await POST(request("https://klear.example"), params)).status).toBe(409);
  expect(contactRunner).not.toHaveBeenCalled();

  vi.mocked(inspect).mockResolvedValue({
    derived: { ok: true, value: { leg, vault: leg } },
    glance: { ok: true, value: { mode: "active" } },
  } as never);
  vi.mocked(contactRunner).mockResolvedValue({ ...sample, phase: "preparing" });
  expect((await POST(request("https://klear.example"), params)).status).toBe(200);
  expect(expectedAccounts).toHaveBeenCalledOnce();
  expect(contactRunner).toHaveBeenCalledExactlyOnceWith(endpoint, payload.token, judge, "start", manager);
});
