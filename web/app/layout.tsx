import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font: no request ever leaves for a font host.
const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  // SITE_URL when set; on Vercel, the production domain it provides to every build.
  metadataBase: new URL(
    process.env.SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  ),
  title: { default: "Klear: when your AI trader fails, anyone can bring your money home", template: "%s · Klear" },
  description:
    "A keyless NEAR contract lets anyone rescue an investor’s funds across Hyperliquid and Base, and pays the guardian only after delivery.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d0f" },
  ],
};

const themeScript = `try {
  const theme = localStorage.getItem("klear:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request's headers renders every page per request, which a nonce-based CSP requires
  // (proxy.ts sets x-nonce; Next.js applies it to its own scripts). Chain reads stay in the Data Cache.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
