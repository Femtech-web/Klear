import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/investor",
  "/agents",
  "/try",
  "/judges",
  "/how",
  "/rules",
  "/strategies",
  "/strategies/practice.keel-factory-bcf915.testnet",
  "/create",
  "/practice",
  "/trust",
  "/proof",
  "/proof/rescue",
  "/proof/deleverage",
  "/proof/agents",
  "/proof/replay",
  "/proof/replay/0x61f35978eb33bad00644bc9549850e7a7c65186e",
  "/proof/contracts",
  "/proof/attacks",
  "/proof/factory",
  "/proof/drill",
  "/proof/sealed",
  "/proof/mandate",
  "/proof/mainnet",
];

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

    // Keep the wallet panel's background poll deterministic while the page still renders its live server reads.
    if (path === "/practice" || path.startsWith("/strategies/")) {
      await page.route("**/api/keel/strategy?judge=*", (route) =>
        route.fulfill({
          json: {
            status: { mode: "active" },
            job: null,
            rescue: { perp: "open", spot: "open", exitNonce: null, sweepNonce: null },
            payouts: [],
          },
        }),
      );
    }
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1, h2").first()).toBeVisible();
    await expect(page.getByText("Testnet.", { exact: false }).first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "nothing wider than the viewport").toBeLessThanOrEqual(1);
    // Content clipped at the edge does not scroll the page, so look for it too: anything past the right edge
    // must sit inside something meant to scroll sideways (a table, a command, the menus).
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .filter((el) => !el.closest("[role=region], pre, nav, code, .overflow-x-auto, [aria-hidden=true]"))
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`)
        .slice(0, 5),
    );
    expect(clipped, "nothing cut off at the right edge").toEqual([]);

    // Audit the settled page: with reduced motion nothing is mid-fade (entrance animations measure as
    // faint text while they run), and the chart's draw-in has finished.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(400);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
    expect(foreign, "the browser should only ever talk to this site").toEqual([]);
    expect(errors).toEqual([]);
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

test("the navbar theme follows the device and remembers a manual choice across documents", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark mode" });
  const html = page.locator("html");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(html).toHaveCSS("color-scheme", "dark");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Practice" }).click();
  await expect(html).toHaveCSS("color-scheme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await page.reload();
  await expect(html).toHaveCSS("color-scheme", "light");
});

test("the wallet picker reached from the homepage loads its icons and opens a sandbox under the wallet CSP", async ({
  page,
}) => {
  await page.route("https://raw.githubusercontent.com/near/near-cli-connect/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.selector.ready({
        signIn: ({ network }) => {
          if (network !== "testnet") throw new Error("Expected testnet");
          const button = document.createElement("button");
          button.textContent = "Approve";
          document.body.prepend(button);
          return new Promise((resolve) => {
            button.addEventListener("click", () => resolve([{ accountId: "klear-wallet-test.testnet" }]));
            window.selector.ui.showIframe();
          });
        },
      });`,
    }),
  );
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") violations.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const [walletDocument] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/practice") && response.request().isNavigationRequest(),
    ),
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Practice" }).click(),
  ]);
  expect(walletDocument.headers()["content-security-policy"]).toContain("frame-src 'self'");
  await page.waitForLoadState("load");
  const trigger = page.getByRole("button", { name: "Connect a NEAR testnet wallet" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Connect a NEAR testnet wallet" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: /Meteor Wallet/ })).toBeEnabled();
  await expect(picker.getByRole("button", { name: /Intear Wallet/ })).toBeEnabled();
  await expect
    .poll(() =>
      picker
        .locator("img")
        .evaluateAll(
          (icons) =>
            icons.filter((icon) => icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0).length,
        ),
    )
    .toBe(4);
  const axe = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await picker.getByRole("button", { name: /NEAR CLI/ }).click();
  const sandbox = page.locator('iframe[sandbox="allow-scripts"]');
  await expect(sandbox).toBeVisible();
  await expect(page.locator(".hot-connector-popup .modal-container")).toHaveCSS("opacity", "1");
  await sandbox.contentFrame().getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("klear-wallet-test.testnet", { exact: true })).toBeVisible();
  expect(violations).toEqual([]);

  const [proofDocument] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/proof") && response.request().isNavigationRequest()),
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Proof", exact: true }).click(),
  ]);
  expect(proofDocument.headers()["content-security-policy"]).toContain("frame-src 'none'");
});

test("Try it leads to recorded receipts, investor setup, and the live drill", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Try it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Try Klear" })).toBeVisible();
  // The live attempts render without sending anything; each button names its attempt.
  await expect(page.getByRole("heading", { name: "Try to break it, live" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Try it: / })).toHaveCount(3);
  const walkthrough = page.getByRole("region", { name: "Recorded rescue walkthrough" });
  await expect(walkthrough.getByRole("heading", { name: "The AI trades", exact: true })).toBeVisible();
  await walkthrough.getByRole("button", { name: "Manager goes silent" }).click();
  await expect(walkthrough.getByRole("heading", { name: "Silence limit passes" })).toBeVisible();
  const next = walkthrough.getByRole("button", { name: "Next step" });
  await next.click();
  await expect(walkthrough.getByRole("heading", { name: "The judge signs the exit" })).toBeVisible();
  await next.click();
  await expect(walkthrough.getByRole("heading", { name: "USDC delivery verified" })).toBeVisible();
  await expect(walkthrough.getByRole("list", { name: "Recorded evidence" }).getByRole("link")).toHaveCount(2);
  const scrubber = walkthrough.getByRole("slider", { name: "Scrub rescue milestones" });
  await scrubber.press("End");
  await expect(scrubber).toHaveAttribute("aria-valuetext", "25:17, WETH delivery verified");
  await expect(walkthrough.getByRole("list", { name: "Recorded evidence" }).getByRole("link")).toHaveCount(2);
  await walkthrough.getByRole("button", { name: "Replay from the start" }).click();
  await expect(walkthrough.getByRole("heading", { name: "The AI trades", exact: true })).toBeVisible();
  await walkthrough.getByRole("button", { name: "Play rescue" }).click();
  await expect(walkthrough.getByRole("heading", { name: "Silence limit passes" })).toBeVisible();
  await walkthrough.getByRole("button", { name: "Pause replay" }).click();
  await page.getByRole("link", { name: /See investor setup/ }).click();
  await expect(page.getByRole("heading", { name: "From setup to exit" })).toBeVisible();
  await page.getByRole("link", { name: "Inspect the practice strategy without a wallet" }).click();
  await expect(page.getByRole("list", { name: "Investor journey" })).toBeVisible();
  await page.goto("/investor");
  await page.getByRole("link", { name: "Start testnet setup" }).click();
  await expect(page.getByRole("heading", { name: "Create a strategy" })).toBeVisible();
  await page.goto("/try");
  await page.getByRole("link", { name: /Open the live drill/ }).click();
  await expect(page.getByRole("heading", { name: "Rescue a strategy yourself" })).toBeVisible();
  const attempts = page.getByRole("region", { name: "Drill attempts" });
  await expect(attempts.getByRole("columnheader")).toHaveCount(3);
  expect(await attempts.evaluate((region) => region.scrollWidth - region.clientWidth)).toBeLessThanOrEqual(1);
});

test("an agent can use the hosted MCP server: handshake, tools, and a live inspection", async ({ request }) => {
  const rpc = (id: number, method: string, params: object = {}) =>
    request.post("/api/mcp", {
      data: { jsonrpc: "2.0", id, method, params },
      headers: { accept: "application/json, text/event-stream" },
    });
  const init = await (
    await rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    })
  ).json();
  expect(init.result.serverInfo.name).toBe("klear");
  const tools = await (await rpc(2, "tools/list")).json();
  expect(tools.result.tools.map((t: { name: string }) => t.name)).toContain("verify_sealed_receipt");
  const inspected = await (
    await rpc(3, "tools/call", {
      name: "inspect_strategy",
      arguments: { judge: "practice.keel-factory-bcf915.testnet" },
    })
  ).json();
  expect(inspected.result.isError).toBe(false);
  expect(inspected.result.structuredContent.checks).toHaveLength(6);
  expect((await request.get("/api/mcp")).status()).toBe(405);
});
