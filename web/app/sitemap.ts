import type { MetadataRoute } from "next";
import { PROOF } from "@/components/site/nav-items";
import { replay } from "@/lib/data/replay";

const base = process.env.SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    "",
    "/judges",
    "/investor",
    "/try",
    "/how",
    "/rules",
    "/strategies",
    "/create",
    "/practice",
    "/trust",
    ...PROOF.map((p) => p.href),
  ];
  return [
    ...pages.map((p) => ({ url: `${base}${p}` })),
    ...replay.agents.map((a) => ({ url: `${base}/proof/replay/${a.address}` })),
  ];
}
