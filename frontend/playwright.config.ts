import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 5000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    headless: true,
    actionTimeout: 15000,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
});
