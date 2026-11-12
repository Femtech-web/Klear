import { chromium } from "@playwright/test";
const S = process.argv[2];
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => /CSP|Content.Security|Refused|error/i.test(m.text()) && !/inter\.css/.test(m.text()) && errors.push(m.text().slice(0, 220)));
await page.goto("http://localhost:3101/strategies/practice.keel-factory-bcf915.testnet", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Connect a NEAR testnet wallet" }).click();
await page.waitForTimeout(2500);
for (const f of page.frames()) { const t = f.getByText("NEAR CLI", { exact: true }); if (await t.count()) { await t.first().click(); break; } }
await page.waitForTimeout(4000);
const frameWith = async (sel) => { for (const f of page.frames()) if (await f.locator(sel).count()) return f; return null; };
let f = await frameWith('input[placeholder="e.g. yourname.near"]');
await f.getByPlaceholder("e.g. yourname.near").fill("keel-visitor-19c0ef.testnet");
await f.getByRole("button", { name: "Next" }).click();
await page.waitForTimeout(1500);
await f.getByText("Keychain").first().click();
await f.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(3000);
console.log("signed in shown:", await page.getByText("keel-visitor-19c0ef.testnet").count());
await page.getByRole("textbox").first().fill("0.01").catch(() => {});
await page.locator("input[inputmode=decimal]").fill("0.01");
await page.getByRole("button", { name: "Add to the pool" }).click();
await page.waitForTimeout(5000);
for (const fr of page.frames()) {
  const t = await fr.locator("body").innerText().catch(() => "");
  if (/near |transaction|sign/i.test(t) && fr !== page.mainFrame()) console.log("---- wallet frame ----\n" + t.slice(0, 2500));
}
// Run the wallet's command as its user would (the visitor's own keychain), then paste the hash.
const { spawnSync } = await import("node:child_process");
let cmdFrame = null;
for (const fr of page.frames()) if (/Run this command/.test(await fr.locator("body").innerText().catch(() => ""))) cmdFrame = fr;
const r = spawnSync("../node_modules/.bin/near", ["contract", "call-function", "as-transaction", "practice.keel-factory-bcf915.testnet", "fund_pool", "json-args", "{}",
  "prepaid-gas", "30 Tgas", "attached-deposit", "0.01 NEAR", "sign-as", "keel-visitor-19c0ef.testnet", "network-config", "testnet", "sign-with-keychain", "send"],
  { env: { ...process.env, HOME: process.argv[3] }, encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
const hash = (out.match(/Transaction ID: ([A-Za-z0-9]+)/) || [])[1];
console.log("sent", hash);
await cmdFrame.locator("input").last().fill(hash);
await cmdFrame.getByRole("button", { name: "Verify" }).click();
await page.waitForTimeout(8000);
console.log("page result:", await page.locator("[role=status], [role=alert]").allInnerTexts());
await page.screenshot({ path: `${S}/wallet-tx.png` });
console.log("errors:", errors.slice(0, 6));
await b.close();
