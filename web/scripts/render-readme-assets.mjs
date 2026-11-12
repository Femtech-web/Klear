// Renders the README's architecture image, light and dark, from docs/assets/src/*.html.
// `node scripts/render-readme-assets.mjs` (from web/); the HTML loads the site's fonts from Google Fonts.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ASSETS = [
  { src: "architecture", width: 1400, height: 900 },
];

const browser = await chromium.launch(process.env.CI ? {} : { channel: "chrome" });
for (const a of ASSETS) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: a.width, height: a.height }, deviceScaleFactor: 2 });
    await page.goto(`file://${root}docs/assets/src/${a.src}.html`);
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${root}docs/assets/${a.src}-${theme}.png`,
      clip: { x: 0, y: 0, width: a.width, height: a.height },
    });
    await page.close();
    console.log(`docs/assets/${a.src}-${theme}.png`);
  }
}
await browser.close();
