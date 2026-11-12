import type { NextConfig } from "next";

/**
 * Static security headers for every response. The Content-Security-Policy carries a fresh nonce per
 * request, so it is set in `proxy.ts`.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // A nonce-based CSP needs every page rendered per request, which rules out the static shell Cache
  // Components prerenders. Chain reads are never cached (lib/chain/rpc.ts).
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // web/ is the app's root (the repository's root holds the Rust workspace and the contracts).
  turbopack: { root: process.cwd() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The evidence moved under /proof; old links keep working.
  async redirects() {
    return [
      { source: "/replay/:path*", destination: "/proof/replay/:path*", permanent: true },
      { source: "/moment", destination: "/proof/rescue", permanent: true },
      { source: "/live", destination: "/proof/contracts", permanent: true },
      { source: "/break", destination: "/proof/attacks", permanent: true },
    ];
  },
};

export default nextConfig;
