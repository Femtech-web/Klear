import { crc32 } from "@/lib/keel/abi";

/**
 * The NEAR transactions a wallet signs for Klear, as plain data (NEAR Connect's action format). Pure: no
 * wallet and no network here, so every call the site can ask a wallet to sign is visible in one file.
 */

export interface FunctionCall {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
}

export interface Tx {
  receiverId: string;
  actions: FunctionCall[];
}

const TGAS = 1_000_000_000_000n;
const call = (
  receiverId: string,
  methodName: string,
  args: Record<string, unknown>,
  deposit = "0",
  tgas = 300n,
): Tx => ({
  receiverId,
  actions: [{ type: "FunctionCall", params: { methodName, args, gas: (tgas * TGAS).toString(), deposit } }],
});

// ---- a guardian's rescue (anyone) ----

/** Ask NEAR's MPC network to verify an EVM log; the signer becomes its attester (1 yoctoNEAR). */
export const attest = (judge: string, chain: "hyperevm" | "base", log: unknown) =>
  call(judge, "attest", { chain, log }, "1");
export const openFlatten = (judge: string, perp: string, spot: string) => call(judge, "open_flatten", { perp, spot });
export const settle = (judge: string, perp: string, spot: string) => call(judge, "settle", { perp, spot });
export const confirmExit = (judge: string, receipt: string) => call(judge, "confirm_exit", { receipt });
export const fundPool = (judge: string, yocto: string) => call(judge, "fund_pool", {}, yocto, 30n);

// ---- the investor ----

export const requestExit = (judge: string) => call(judge, "request_exit", {}, "0", 30n);
export const rearm = (judge: string) => call(judge, "rearm", {}, "0", 30n);

// ---- creating a strategy ----

export interface MandateInput {
  /** Hyperliquid perp index and size decimals (ETH on testnet: 4 and 4). */
  perp: number;
  szDecimals: number;
  maxOrderEth: number;
  bandBp: number;
  maxBasisBp: number;
  maxLeverageX: number;
  floorUsd: number;
  heartbeatMin: number;
  exitOnSilence: boolean;
  flattenRewardNear: number;
  spotRewardNear: number;
}

export const DEFAULT_MANDATE: MandateInput = {
  perp: 4,
  szDecimals: 4,
  maxOrderEth: 0.01,
  bandBp: 100,
  maxBasisBp: 500,
  maxLeverageX: 2,
  floorUsd: 3,
  heartbeatMin: 15,
  exitOnSilence: true,
  flattenRewardNear: 0.1,
  spotRewardNear: 0.05,
};

const yocto = (near: number) => (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString();

/** The judge's policy JSON, with the fixed parameters the practice strategy runs on. */
export function policy(m: MandateInput): Record<string, unknown> {
  return {
    perp: m.perp,
    sz_decimals: m.szDecimals,
    band_bp: m.bandBp,
    max_basis_bp: m.maxBasisBp,
    fee_bp: 5,
    max_order_sz: Math.round(m.maxOrderEth * 1e8),
    tolerance: 100000,
    max_loss_usd6: 1000000,
    settle_delay_l1: 300,
    max_evidence_age_s: 3600,
    max_perp_age_s: 300,
    order_ttl_s: 300,
    job_ttl_s: 14400,
    max_failed_attempts: 3,
    dust: 10000,
    repair_reward: "0",
    flatten_reward: yocto(m.flattenRewardNear),
    spot_reward: yocto(m.spotRewardNear),
    max_leverage_bp: Math.round(m.maxLeverageX * 10_000),
    equity_floor_usd6: Math.round(m.floorUsd * 1e6),
    spot_haircut_bp: 100,
    usdc_dust_usd6: 50000,
    hedge: false,
    heartbeat_s: m.heartbeatMin * 60,
    on_silence: m.exitOnSilence ? "exit" : "nothing",
  };
}

export const WETH_BASE_SEPOLIA = "0x4200000000000000000000000000000000000006";

/** The judge's config, as scripts/testnet/factory.sh builds it. */
export function strategyConfig(a: {
  name: string;
  leg: string;
  vault: string;
  investor: string;
  investorAccount: string;
  manager?: string;
  mandate: MandateInput;
}) {
  return {
    strategy_id: crc32(a.name),
    chain_id: 998,
    leg: a.leg,
    spot_account: a.vault,
    spot_token: WETH_BASE_SEPOLIA,
    probe: a.vault,
    spot_chain: "base",
    spot_chain_id: 84532,
    investor: a.investor,
    investor_account: a.investorAccount,
    ...(a.manager ? { manager: a.manager } : {}),
    policy: policy(a.mandate),
  };
}

export const createStrategy = (
  factory: string,
  name: string,
  config: Record<string, unknown>,
  label: string,
  depositYocto: string,
) => call(factory, "create_strategy", { name, config, label }, depositYocto, 200n);

/** A strategy name the factory accepts: 2 to 32 of a-z 0-9 - _, starting with a letter or digit. */
export const validName = (name: string) => /^[a-z0-9][a-z0-9_-]{1,31}$/.test(name);

// ---- results ----

/** The judge's refusal in a failed transaction outcome ("mandate:not-the-investor"), if it failed. */
export function failure(outcome: unknown): string | null {
  const text = JSON.stringify(outcome ?? null);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1].trim();
  return /"Failure"/.test(text) ? (text.match(/"Failure":\{[^}]*\}/)?.[0] ?? "the transaction failed") : null;
}
