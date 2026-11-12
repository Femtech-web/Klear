import { chromium } from "@playwright/test";
const S = process.argv[2];
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => (m.type() === "error" || /Content.Security|CSP|Refused/i.test(m.text())) && errors.push(m.text().slice(0, 200)));
await page.goto("http://localhost:3101/practice", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Connect a NEAR testnet wallet" }).click();
await page.waitForTimeout(2500);
await page.getByText("NEAR CLI", { exact: true }).first().click().catch(async () => {
  for (const f of page.frames()) { const t = f.getByText("NEAR CLI", { exact: true }); if (await t.count()) { await t.first().click(); break; } }
});
await page.waitForTimeout(4000);
let frame = null;
for (const f of page.frames()) if (await f.getByPlaceholder("e.g. yourname.near").count()) frame = f;
console.log("frames", page.frames().length, "input frame", Boolean(frame));
if (frame) {
  await frame.getByPlaceholder("e.g. yourname.near").fill("keel-visitor-19c0ef.testnet");
  await frame.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(3000);
  console.log("---- step 2 text ----\n" + (await frame.locator("body").innerText()).slice(0, 1500));
}
await page.screenshot({ path: `${S}/wallet-step2.png` });
console.log("errors:", errors.slice(0, 8));
await b.close();
