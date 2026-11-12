import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no request ever leaves for a font host.
const serif = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz", "SOFT"], display: "swap" });
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: "Keel: when your AI trader fails, anyone can bring your money home", template: "%s · Keel" },
  description:
    "An AI trades within rules it cannot change, held by a NEAR contract with no keys. If it fails, anyone can bring the money home across chains, and is paid only when it lands.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#08111d" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request's headers renders every page per request, which a nonce-based CSP requires
  // (proxy.ts sets x-nonce; Next.js applies it to its own scripts). Chain reads stay in the Data Cache.
  await headers();
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
