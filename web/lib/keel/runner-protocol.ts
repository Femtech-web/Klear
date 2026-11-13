export const RUNNER_TOKEN = /^[a-f0-9]{64}$/;
export const NEAR_TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
export const EVM_TX = /^0x[a-f0-9]{64}$/i;
export const CLIENT_ORDER_ID = /^0x[a-f0-9]{32}$/i;
export type RunnerAction = "status" | "start" | "pause";
export type RunnerPhase = "idle" | "preparing" | "funding" | "running" | "pausing" | "paused" | "stopped" | "error";

export type RunnerStatus = {
  judge: string;
  manager: string;
  phase: RunnerPhase;
  courier: boolean;
  profile: "sealed" | "standard";
  heartbeat: string | null;
  order: { cloid: string; tx: string | null } | null;
  problem: "manager" | "strategy" | null;
};

export type RunnerReport = RunnerStatus & {
  checkIn: { state: "confirmed" | "pending" | "unavailable"; at?: number };
  market: { state: "observed" | "queued" | "waiting" | "unavailable"; outcome?: string };
};

export function runnerOrigin(input: string): string {
  const url = new URL(input.trim());
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.[a-z0-9-]+\.ts\.net)$/.test(host)
  )
    throw new Error("Enter the HTTPS address from Tailscale Funnel or a Cloudflare Quick Tunnel.");
  return url.origin;
}
