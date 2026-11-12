import { config } from "@/lib/config";

export function usd(x: number, digits = 0): string {
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** yoctoNEAR to NEAR, trimmed. */
export function near(yocto: bigint, digits = 3): string {
  const whole = yocto / 10n ** 24n;
  const frac = (yocto % 10n ** 24n).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} NEAR`;
}

/** An integer amount with `decimals`, as a decimal string. */
export function units(amount: bigint, decimals: number, digits = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""}`;
}

export function short(hash: string, head = 6, tail = 4): string {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function utc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export type Chain = "near" | "base" | "hyperevm";

/** An explorer link for a transaction on one of the chains Keel uses. */
export function txUrl(chain: Chain, tx: string): string {
  const base = config.explorers[chain];
  return chain === "near" ? `${base}/txns/${tx}` : `${base}/tx/${tx}`;
}

export function accountUrl(chain: Chain, account: string): string {
  const base = config.explorers[chain];
  return chain === "near" ? `${base}/address/${account}` : `${base}/address/${account}`;
}

/** An address on Hyperliquid mainnet's explorer (the replay's agents traded real money there). */
export const hyperliquidAddressUrl = (address: string) => `https://app.hyperliquid.xyz/explorer/address/${address}`;

/** How long ago a unix-seconds time was, coarsely ("4 min", "3 h", "2 days"). */
export function ago(unixSeconds: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - unixSeconds));
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** The daily drill's open rescue window in UTC, e.g. "14:40 to 17:40 UTC". */
export function drillWindowUtc(d: {
  utcHour: number;
  utcMinute: number;
  dueAfterMinutes: number;
  graceHours: number;
}): string {
  const at = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const due = d.utcHour * 60 + d.utcMinute + d.dueAfterMinutes;
  return `${at(due)} to ${at(due + d.graceHours * 60)} UTC`;
}
