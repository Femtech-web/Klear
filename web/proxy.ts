import { NextResponse, type NextRequest } from "next/server";

/**
 * A strict Content-Security-Policy with a fresh nonce per request (Next.js applies it to its own scripts).
 * Every chain read happens on the server, so the browser talks to nothing but this site: no RPCs, no
 * trackers, no third-party fonts. The pages where you connect a wallet are the one exception: NEAR Connect
 * fetches the wallet's code and runs it in a sandboxed iframe that inherits this policy, so those pages also
 * allow the wallets' hosts and NEAR's RPC, and nothing else.
 */
const WALLET_PAGES = /^\/(practice|create|strategies\/[^/]+)$/;
const WALLET_HOSTS = [
  "https://raw.githubusercontent.com", // the wallets' code (NEAR Connect's manifest points there)
  "https://wallet.intear.tech",
  "https://test.rpc.fastnear.com",
  "https://rpc.testnet.fastnear.com",
  "https://archival-rpc.testnet.fastnear.com",
];
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const wallet = WALLET_PAGES.test(request.nextUrl.pathname);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React sets a few inline style attributes; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${wallet ? " https://raw.githubusercontent.com https://storage.herewallet.app" : ""}`,
    "font-src 'self'",
    `connect-src 'self'${wallet ? " " + WALLET_HOSTS.join(" ") : ""}${dev ? " ws: http://127.0.0.1:* http://localhost:*" : ""}`,
    wallet ? "frame-src 'self'" : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
