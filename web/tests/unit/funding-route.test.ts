import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/keel/funding/route";
import { erc20Balance } from "@/lib/chain/evm";
import { inspect, trustChecks } from "@/lib/keel/registry";
import { postJson } from "@/lib/chain/rpc";
import { view } from "@/lib/chain/near";
import { expectedAccounts } from "@/lib/keel/activation-accounts";

vi.mock("@/lib/keel/activation-accounts", () => ({ expectedAccounts: vi.fn() }));
vi.mock("@/lib/keel/registry", () => ({ inspect: vi.fn(), trustChecks: vi.fn() }));
vi.mock("@/lib/chain/near", () => ({ view: vi.fn() }));
vi.mock("@/lib/chain/evm", () => ({ erc20Balance: vi.fn() }));
vi.mock("@/lib/chain/rpc", async (original) => ({ ...(await original<object>()), postJson: vi.fn() }));
const funder = `0x${"a".repeat(40)}`,
  leg = `0x${"b".repeat(40)}`,
  vault = `0x${"c".repeat(40)}`;
const payload = { judge: "example.keel.testnet", funder, amount: "12", kind: "usdc", phase: "prepare" };
const request = (body: unknown, origin = "http://localhost") =>
  new NextRequest("http://localhost/api/keel/funding", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(inspect).mockResolvedValue({
    strategy: { ok: true, value: { investor: funder, leg, vault, mode: "active", exitRequested: false } },
    derived: { ok: true, value: { leg, vault } },
    glance: { ok: true, value: { silent: false, exitOnSilence: true } },
  } as never);
  vi.mocked(trustChecks).mockReturnValue(Array.from({ length: 6 }, () => ({ check: "verified", pass: true })));
  vi.mocked(view).mockResolvedValue({ config: { chain_id: 998, spot_chain_id: 84532 } });
  vi.mocked(erc20Balance).mockResolvedValue(10n ** 16n);
  vi.mocked(postJson).mockImplementation(async (_url, body) =>
    (body as { type?: string }).type === "clearinghouseState"
      ? { withdrawable: "100" }
      : (body as { type?: string }).type === "userRole"
        ? { role: "missing" }
        : { result: "0x14a34" },
  );
});
it("rejects other origins, mainnet, failed checks and wrong payout wallets before a signature or relay", async () => {
  expect((await POST(request(payload, "https://elsewhere.example"))).status).toBe(403);
  vi.mocked(view).mockResolvedValueOnce({ config: { chain_id: 999, spot_chain_id: 8453 } });
  expect((await POST(request(payload))).status).toBe(409);
  vi.mocked(trustChecks).mockReturnValueOnce([{ check: "controller", pass: false }]);
  expect((await POST(request(payload))).status).toBe(409);
  expect((await POST(request({ ...payload, funder: vault }))).status).toBe(409);
  vi.mocked(expectedAccounts).mockRejectedValueOnce(new Error("Wrong deployment"));
  expect((await POST(request(payload))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
it("prepares only the verified destination and shows the new account activation deduction", async () => {
  const response = await POST(request({ ...payload, destination: funder, hyperliquidChain: "Mainnet" }));
  const plan = await response.json();
  expect(plan.action).toMatchObject({ destination: leg, amount: "12", hyperliquidChain: "Testnet" });
  expect(plan.activationFee).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it("wraps only the WETH shortfall and transfers to the verified vault without an approval allowance", async () => {
  const response = await POST(request({ ...payload, kind: "weth", amount: "0.02" }));
  const plan = await response.json();
  expect(plan.transactions).toHaveLength(2);
  expect(plan.transactions[0]).toMatchObject({ data: "0xd0e30db0", value: `0x${(10n ** 16n).toString(16)}` });
  expect(plan.transactions[1].data.startsWith("0xa9059cbb")).toBe(true);
  expect(plan.transactions[1].data).toContain(vault.slice(2));
  vi.mocked(erc20Balance).mockResolvedValue(2n * 10n ** 16n);
  expect((await (await POST(request({ ...payload, kind: "weth", amount: "0.02" }))).json()).transactions).toHaveLength(
    1,
  );
});
it("never retries an ambiguous signed transfer and cannot be turned into an arbitrary exchange relay", async () => {
  const signed = {
    ...payload,
    phase: "submit",
    time: Date.now(),
    signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
    action: { type: "withdraw3", destination: funder },
  };
  vi.mocked(fetch).mockRejectedValue(new Error("Disconnected"));
  const response = await POST(request(signed));
  expect(response.status).toBe(502);
  expect((await response.json()).uncertain).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("https://api.hyperliquid-testnet.xyz/exchange");
  expect(JSON.parse(init!.body as string).action).toMatchObject({
    type: "usdSend",
    destination: leg,
    hyperliquidChain: "Testnet",
  });
});
