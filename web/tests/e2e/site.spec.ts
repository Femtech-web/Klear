import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/how", "/rules", "/replay", "/replay/0x61f35978eb33bad00644bc9549850e7a7c65186e", "/moment", "/live", "/break", "/trust"];

for (const path of PAGES) {
  test(`${path} renders, talks only to this site, fits a phone and passes WCAG 2.2 AA`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && u.origin !== origin) foreign.push(r.url());
    });
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1, h2").first()).toBeVisible();
    await expect(page.getByText("Testnet.", { exact: false }).first()).toBeVisible();

    expect(foreign, "the browser should only ever talk to this site").toEqual([]);
    expect(errors).toEqual([]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "nothing wider than the viewport").toBeLessThanOrEqual(1);

    // Audit the settled page: with reduced motion nothing is mid-fade (entrance animations measure as
    // faint text while they run), and the chart's draw-in has finished.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
  });
}

test("every response carries a nonce CSP and the security headers", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("connect-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("the rules simulator answers a change of rules", async ({ page }) => {
  await page.goto("/rules");
  const kept = page.locator("[aria-live=polite] p").nth(1);
  const before = await kept.textContent();
  await page.getByText("−50%").click();
  await expect(kept).not.toHaveText(before ?? "", { timeout: 3000 });
});

test("an unknown page is a 404 with a way home", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: /back home/i })).toBeVisible();
});
