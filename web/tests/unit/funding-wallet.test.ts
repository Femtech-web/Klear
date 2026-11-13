import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeFunding } from "@/lib/wallet/activate";
import { usdAction, type FundingPlan } from "@/lib/activation";

const funder = `0x${"a".repeat(40)}`;
const plan: FundingPlan = {
  judge: "example.testnet",
  kind: "weth",
  funder,
  destination: `0x${"b".repeat(40)}`,
  amount: "0.01",
  transactions: [
    { to: `0x${"c".repeat(40)}`, data: "0xd0e30db0", value: "0x2386f26fc10000", label: "Wrap ETH" },
    { to: `0x${"c".repeat(40)}`, data: "0xa9059cbb", label: "Transfer WETH" },
  ],
};
const hash = `0x${"d".repeat(64)}`;
const request = vi.fn();
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("window", { ethereum: { request } });
  request.mockImplementation(async ({ method }) => {
    if (method === "eth_requestAccounts") return [funder];
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_sendTransaction") return hash;
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
  });
});
afterEach(() => vi.unstubAllGlobals());
it("sends wrap and transfer in order, waits for the wrap receipt and checks the account and network again", async () => {
  const updates = vi.fn();
  await executeFunding(plan, updates);
  const methods = request.mock.calls.map(([arg]) => arg.method);
  expect(methods).toEqual([
    "wallet_switchEthereumChain",
    "eth_requestAccounts",
    "eth_chainId",
    "eth_sendTransaction",
    "eth_getTransactionReceipt",
    "eth_requestAccounts",
    "eth_chainId",
    "eth_sendTransaction",
    "eth_getTransactionReceipt",
  ]);
  expect(request.mock.calls[3][0].params[0].value).toBe(plan.transactions![0].value);
  expect(request.mock.calls[7][0].params[0].value).toBeUndefined();
});
it("stops on a cancelled transfer after a successful wrap, and does not repeat either transaction", async () => {
  let sends = 0;
  request.mockImplementation(async ({ method }) => {
    if (method === "eth_requestAccounts") return [funder];
    if (method === "eth_chainId") return "0x14a34";
    if (method === "eth_sendTransaction") {
      sends++;
      if (sends === 2) throw new Error("User rejected");
      return hash;
    }
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
  });
  const updates = vi.fn();
  await expect(executeFunding(plan, updates)).rejects.toThrow("User rejected");
  expect(sends).toBe(2);
  expect(updates).toHaveBeenCalledWith("Wrap ETH: confirmed.", hash);
});
it("refuses an account or network switch before any transfer", async () => {
  request.mockResolvedValueOnce(null).mockResolvedValueOnce([`0x${"f".repeat(40)}`]);
  await expect(executeFunding(plan, vi.fn())).rejects.toThrow("account changed");
  expect(request.mock.calls.some(([arg]) => arg.method === "eth_sendTransaction")).toBe(false);
  request.mockClear();
  request.mockImplementation(async ({ method }) =>
    method === "eth_requestAccounts" ? [funder] : method === "eth_chainId" ? "0x2105" : null,
  );
  await expect(executeFunding(plan, vi.fn())).rejects.toThrow("network changed");
  expect(request.mock.calls.some(([arg]) => arg.method === "eth_sendTransaction")).toBe(false);
});
it("signs a Testnet-only typed transfer and submits it once, with no token allowance", async () => {
  const action = usdAction(plan.destination, "12", 1700000000000);
  request.mockImplementation(async ({ method }) =>
    method === "eth_requestAccounts"
      ? [funder]
      : method === "eth_chainId"
        ? "0x3e6"
        : method === "eth_signTypedData_v4"
          ? `0x${"1".repeat(128)}1b`
          : null,
  );
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) });
  vi.stubGlobal("fetch", fetch);
  await executeFunding({ ...plan, kind: "usdc", amount: "12", action }, vi.fn());
  const typed = JSON.parse(request.mock.calls.find(([arg]) => arg.method === "eth_signTypedData_v4")![0].params[1]);
  expect(typed.message.hyperliquidChain).toBe("Testnet");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.some(([arg]) => arg.method === "eth_sendTransaction")).toBe(false);
});
