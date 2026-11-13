import { expect, test } from "@playwright/test";

test("strategy filters are shareable and saved strategies survive a return to the workspace", async ({ page }) => {
  const judge = "practice.keel-factory-bcf915.testnet";
  const search = page.getByRole("searchbox", { name: "Find a strategy" });
  // A public RPC may be temporarily unavailable; retry the read before testing local filter behavior.
  await expect(async () => {
    await page.goto("/strategies?q=practice");
    await expect(search).toHaveValue("practice", { timeout: 1500 });
  }).toPass({ timeout: 25000, intervals: [1000, 2000] });
  const save = page.getByRole("button", { name: `Save strategy ${judge}`, exact: true });
  await save.click();
  await expect(page.getByRole("button", { name: `Unsave strategy ${judge}`, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("group", { name: "Filter strategies" })
    .getByRole("button", { name: /^Saved here/ })
    .click();
  await expect(page).toHaveURL(/view=saved/);
  const investor = page.getByRole("textbox", { name: "Investor’s NEAR account" });
  await investor.fill("no-such-investor.testnet");
  await expect(page).toHaveURL(/investor=no-such-investor.testnet/);
  await expect(page.getByRole("heading", { name: "No strategies match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Show all strategies", exact: true }).click();
  await page
    .getByRole("group", { name: "Filter strategies" })
    .getByRole("button", { name: /^Saved here/ })
    .click();
  await page.reload();
  await expect(page).toHaveURL(/view=saved/);
  await expect(page.getByRole("button", { name: `Unsave strategy ${judge}`, exact: true })).toBeVisible();
  await page.goto("/investor?view=saved#manage");
  const unsave = page.getByRole("button", { name: `Unsave strategy ${judge}`, exact: true });
  await expect(unsave).toBeVisible();
  await unsave.click();
  await expect(unsave).toHaveCount(0);
});

test("a changed payout or mandate invalidates the address preview", async ({ page }) => {
  await page.route("**/api/keel/predict?*", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    await route.fulfill({
      json: {
        judge: `${q.get("name")}.keel-factory-bcf915.testnet`,
        taken: false,
        salt: `0x${"1".repeat(64)}`,
        controllers: { leg: `0x${"2".repeat(40)}`, vault: `0x${"3".repeat(40)}` },
        leg: `0x${"4".repeat(40)}`,
        vault: `0x${"5".repeat(40)}`,
        deployers: { hyperevm: `0x${"6".repeat(40)}`, base: `0x${"7".repeat(40)}` },
        creationCostYocto: "4000000000000000000000000",
      },
    });
  });
  await page.goto("/create");
  await page.getByRole("textbox", { name: "Strategy name", exact: true }).fill("review-test");
  const payout = page.getByRole("textbox", { name: "Your EVM payout address", exact: true });
  await payout.fill(`0x${"a".repeat(40)}`);
  const manager = page.getByRole("textbox", { name: "Manager’s NEAR account", exact: true });
  await manager.fill("manager.testnet");
  const preview = page.getByRole("button", { name: "Preview addresses", exact: true });
  await preview.click();
  const review = page.getByRole("heading", { name: "Review and lock the judge" });
  await expect(review).toBeVisible();
  await expect(page.getByRole("button", { name: "Create the judge", exact: true })).toBeDisabled();
  await payout.fill(`0x${"b".repeat(40)}`);
  await expect(review).toHaveCount(0);
  await preview.click();
  await expect(review).toBeVisible();
  await page.getByText("Trading limits and guardian rewards", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum leverage (x)" }).fill("3");
  await expect(review).toHaveCount(0);
  await preview.click();
  await expect(review).toBeVisible();
  await expect(page.getByText("3× maximum leverage", { exact: false })).toBeVisible();
  await page.reload();
  await expect(manager).toHaveValue("manager.testnet");
  await expect(payout).toHaveValue(`0x${"b".repeat(40)}`);
  await expect(review).toHaveCount(0);
  await preview.click();
  await expect(page.getByText("3× maximum leverage", { exact: false })).toBeVisible();
});

test("an existing judge links to live recovery and a failed preview offers another read", async ({ page }) => {
  let unavailable = true;
  await page.route("**/api/keel/predict?*", async (route) => {
    await route.fulfill(
      unavailable
        ? { status: 503, json: { error: "Preview temporarily unavailable" } }
        : {
            json: {
              judge: "practice.keel-factory-bcf915.testnet",
              taken: true,
              salt: `0x${"1".repeat(64)}`,
              controllers: { leg: `0x${"2".repeat(40)}`, vault: `0x${"3".repeat(40)}` },
              leg: `0x${"4".repeat(40)}`,
              vault: `0x${"5".repeat(40)}`,
              deployers: { hyperevm: `0x${"6".repeat(40)}`, base: `0x${"7".repeat(40)}` },
              creationCostYocto: "4000000000000000000000000",
            },
          },
    );
  });
  await page.goto("/create");
  await page.getByRole("textbox", { name: "Strategy name", exact: true }).fill("practice");
  await page.getByRole("textbox", { name: "Your EVM payout address", exact: true }).fill(`0x${"a".repeat(40)}`);
  await page.getByRole("textbox", { name: "Manager’s NEAR account", exact: true }).fill("manager.testnet");
  const preview = page.getByRole("button", { name: "Preview addresses", exact: true });
  await preview.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Preview temporarily unavailable");
  unavailable = false;
  await preview.click();
  await expect(page.getByRole("link", { name: "Inspect the existing strategy" })).toHaveAttribute(
    "href",
    "/strategies/practice.keel-factory-bcf915.testnet#setup-progress",
  );
  await expect(page.getByRole("button", { name: "Create the judge", exact: true })).toHaveCount(0);
});
