/** Public endpoints (server-side only; the browser never calls a chain). None of these is a secret. */
export const config = {
  nearRpc: process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com",
  hyperliquidInfo: process.env.HYPERLIQUID_INFO ?? "https://api.hyperliquid-testnet.xyz/info",
  baseRpc: process.env.BASE_RPC ?? "https://sepolia.base.org",
  explorers: {
    near: "https://testnet.nearblocks.io",
    base: "https://sepolia.basescan.org",
    hyperevm: "https://testnet.purrsec.com",
  },
  repo: "https://github.com/Femtech-web/Klear",
  /** The daily drill's schedule (.github/workflows/drill.yml): it starts at this UTC time, the rescue
   * becomes due about 40 minutes later, and stays open to anyone for `graceHours` before Klear's own guardian acts. */
  drill: { utcHour: 14, utcMinute: 0, dueAfterMinutes: 40, graceHours: 3 },
} as const;
