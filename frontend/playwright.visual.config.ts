import { defineConfig, devices } from "@playwright/test";
import { VISUAL_BASE_URL, VISUAL_PREVIEW_PORT, VISUAL_VIEWPORT } from "./tests/visual/constants";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/visual-results.json" }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  use: {
    baseURL: VISUAL_BASE_URL,
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    channel: undefined,
    headless: true,
    viewport: VISUAL_VIEWPORT,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    actionTimeout: 15_000,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${VISUAL_PREVIEW_PORT} --strictPort`,
    url: VISUAL_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      CI: "true",
    },
  },
});
