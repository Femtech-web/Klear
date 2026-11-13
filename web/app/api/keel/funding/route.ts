import { NextResponse, type NextRequest } from "next/server";
import { ADDRESS, TESTNET_ACCOUNT, WETH, decimalUnits, usdAction, wethTransfer } from "@/lib/activation";
import { erc20Balance } from "@/lib/chain/evm";
import { view } from "@/lib/chain/near";
import { isRecord, postJson } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { expectedAccounts } from "@/lib/keel/activation-accounts";
import { inspect, trustChecks } from "@/lib/keel/registry";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return json({ error: "Open funding on this website." }, 403);
  if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Request too large." }, 413);
  let submitted = false;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "Request too large." }, 413);
    const body: unknown = JSON.parse(text);
    if (
      !isRecord(body) ||
      typeof body.judge !== "string" ||
      !TESTNET_ACCOUNT.test(body.judge) ||
      typeof body.funder !== "string" ||
      !ADDRESS.test(body.funder) ||
      typeof body.amount !== "string" ||
      (body.kind !== "usdc" && body.kind !== "weth") ||
      (body.phase !== "prepare" && body.phase !== "submit")
    )
      return json({ error: "Invalid funding request." }, 400);
    try {
      decimalUnits(body.amount, body.kind === "usdc" ? 6 : 18);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid amount." }, 400);
    }
    const [x, raw] = await Promise.all([inspect(body.judge), view(body.judge, "get_strategy")]);
    const c = isRecord(raw) && isRecord(raw.config) ? raw.config : null;
    if (
      !c ||
      c.chain_id !== 998 ||
      c.spot_chain_id !== 84532 ||
      !x.strategy.ok ||
      !x.glance.ok ||
      !x.derived.ok ||
      !trustChecks(x).every((check) => check.pass)
    )
      return json({ error: "Both testnet accounts must pass all six live checks before funding." }, 409);
    const s = x.strategy.value;
    if (
      s.mode !== "flattened" &&
      (s.mode !== "active" || s.exitRequested || (x.glance.value.silent && x.glance.value.exitOnSilence))
    )
      return json({ error: "Review the strategy’s exit state before adding funds." }, 409);
    if (!s.investor || body.funder.toLowerCase() !== s.investor.toLowerCase())
      return json({ error: "Select the EVM payout wallet locked in this strategy." }, 409);

    try {
      await expectedAccounts(body.judge, c, x.derived.value.leg, x.derived.value.vault);
    } catch {
      return json(
        {
          error:
            "The accounts could not be matched to the factory’s deployment. Check the live addresses before funding.",
        },
        409,
      );
    }

    if (body.kind === "usdc") {
      if (body.phase === "submit") {
        if (
          !Number.isSafeInteger(body.time) ||
          typeof body.time !== "number" ||
          Math.abs(Date.now() - body.time) > 300000 ||
          !isRecord(body.signature) ||
          typeof body.signature.r !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(body.signature.r) ||
          typeof body.signature.s !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(body.signature.s) ||
          (body.signature.v !== 27 && body.signature.v !== 28)
        )
          return json({ error: "Invalid or expired signed transfer." }, 400);
        const action = usdAction(s.leg, body.amount, body.time);
        // A signed transfer is submitted once. Do not use the read helper's automatic retries here.
        submitted = true;
        const response = await fetch("https://api.hyperliquid-testnet.xyz/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ action, nonce: action.time, signature: body.signature }),
        });
        const result: unknown = response.ok ? await response.json() : null;
        if (!response.ok || !isRecord(result) || result.status !== "ok")
          return json(
            {
              error: "Transfer was not confirmed. Check Hyperliquid history before trying another transfer.",
              uncertain: true,
            },
            502,
          );
        return json({ accepted: true });
      }
      const [source, role] = await Promise.all([
        postJson("https://api.hyperliquid-testnet.xyz/info", { type: "clearinghouseState", user: body.funder }),
        postJson("https://api.hyperliquid-testnet.xyz/info", { type: "userRole", user: s.leg }),
      ]);
      const available = isRecord(source) && typeof source.withdrawable === "string" ? Number(source.withdrawable) : NaN;
      if (!Number.isFinite(available) || Number(body.amount) > available)
        return json(
          {
            error:
              "Not enough withdrawable test USDC in this wallet’s Hyperliquid perpetual account. Add test funds on Hyperliquid first.",
          },
          409,
        );
      if (isRecord(role) && role.role === "missing" && decimalUnits(body.amount, 6) <= 1_000_000n)
        return json(
          { error: "Send more than 1 USDC to cover first-time HyperCore activation and leave a balance." },
          409,
        );
      return json({
        judge: body.judge,
        kind: body.kind,
        funder: body.funder,
        amount: body.amount,
        destination: s.leg,
        action: usdAction(s.leg, body.amount, Date.now()),
        activationFee: isRecord(role) && role.role === "missing",
      });
    }
    if (body.phase !== "prepare")
      return json({ error: "Base transfers are approved directly in your EVM wallet." }, 400);
    const chain = await postJson(config.baseRpc, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    if (!isRecord(chain) || chain.result !== "0x14a34")
      return json({ error: "Base Sepolia could not be verified." }, 503);
    const balance = await erc20Balance(WETH, body.funder);
    const amount = decimalUnits(body.amount, 18);
    const shortfall = amount > balance ? amount - balance : 0n;
    const transactions = [];
    if (shortfall > 0n)
      transactions.push({
        to: WETH,
        data: "0xd0e30db0",
        value: `0x${shortfall.toString(16)}`,
        label: "Wrap Base Sepolia ETH into WETH",
      });
    transactions.push({
      to: WETH,
      data: wethTransfer(s.vault, amount),
      label: "Send WETH to your verified Base vault",
    });
    return json({
      judge: body.judge,
      kind: body.kind,
      funder: body.funder,
      amount: body.amount,
      destination: s.vault,
      transactions,
    });
  } catch {
    return json(
      {
        error: submitted
          ? "Transfer confirmation unavailable. Check Hyperliquid history before trying again."
          : "Funding checks unavailable. No transfer was submitted by this request.",
        uncertain: submitted,
      },
      502,
    );
  }
}
