import { defineConfig, devices } from "@playwright/test";

/**
 * Every page against a production build served locally (`npm run build` first): locally in the installed
 * Google Chrome (no browser download), in CI in Playwright's Chromium. PLAYWRIGHT_BASE_URL runs the same
 * checks against a deployed site instead.
 */
const external = process.env.PLAYWRIGHT_BASE_URL;
const port = 3100;
const chrome = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: external ?? `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop-light",
      use: { ...devices["Desktop Chrome"], ...chrome, colorScheme: "light", viewport: { width: 1366, height: 900 } },
    },
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], ...chrome, colorScheme: "dark", viewport: { width: 1366, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"], ...chrome, colorScheme: "light" } },
  ],
  webServer: external
    ? undefined
    : { command: `npx next start -p ${port}`, port, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
