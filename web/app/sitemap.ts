import type { MetadataRoute } from "next";
import { replay } from "@/lib/data/replay";

const base = process.env.SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/how", "/rules", "/replay", "/moment", "/live", "/break", "/trust"];
  return [...pages.map((p) => ({ url: `${base}${p}` })), ...replay.agents.map((a) => ({ url: `${base}/replay/${a.address}` }))];
}
