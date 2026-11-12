/** Public endpoints (server-side only; the browser never calls a chain). None of these is a secret. */
export const config = {
  nearRpc: process.env.NEAR_RPC ?? "https://rpc.testnet.near.org",
  hyperliquidInfo: process.env.HYPERLIQUID_INFO ?? "https://api.hyperliquid-testnet.xyz/info",
  baseRpc: process.env.BASE_RPC ?? "https://sepolia.base.org",
  /** Live reads are cached for this long, so a page view never waits on more than one round of RPCs. */
  revalidateSeconds: 30,
  explorers: {
    near: "https://testnet.nearblocks.io",
    base: "https://sepolia.basescan.org",
    hyperevm: "https://testnet.purrsec.com",
  },
  repo: "https://github.com/keel-protocol/keel",
} as const;
