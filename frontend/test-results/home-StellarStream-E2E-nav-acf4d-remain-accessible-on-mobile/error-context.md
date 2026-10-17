# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> StellarStream E2E >> navigation and theme controls remain accessible on mobile
- Location: tests\e2e\home.spec.ts:10:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('StellarStream E2E', () => {
  4  |   test('homepage loads and displays app branding', async ({ page }) => {
  5  |     await page.goto('/');
  6  |     await expect(page.locator('h1')).toHaveText('StellarStream');
  7  |     await expect(page.locator('text=Soroban-native MVP')).toBeVisible();
  8  |   });
  9  | 
  10 |   test('navigation and theme controls remain accessible on mobile', async ({ page }) => {
  11 |     await page.setViewportSize({ width: 375, height: 812 });
> 12 |     await page.goto('/');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  13 | 
  14 |     const navigation = page.getByRole('navigation', { name: 'Main' });
  15 |     await expect(navigation).toBeVisible();
  16 |     await expect(navigation.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  17 |     await expect(navigation.getByRole('button', { name: 'Sender dashboard' })).toBeVisible();
  18 |     await expect(navigation.getByRole('button', { name: 'Recipient dashboard' })).toBeVisible();
  19 | 
  20 |     const themeToggle = page.getByRole('button', { name: /switch to (dark|light) mode/i });
  21 |     await expect(themeToggle).toHaveAttribute('aria-pressed', /true|false/);
  22 |     await themeToggle.click();
  23 |     await expect(page.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeVisible();
  24 | 
  25 |     const hasHorizontalOverflow = await page.evaluate(
  26 |       () => document.documentElement.scrollWidth > window.innerWidth,
  27 |     );
  28 |     expect(hasHorizontalOverflow).toBe(false);
  29 |   });
  30 | 
  31 |   test('backend health endpoint responds successfully', async ({ request }) => {
  32 |     const response = await request.get('http://localhost:3001/api/health');
  33 |     expect(response.status()).toBe(200);
  34 |     const body = await response.json();
  35 |     expect(body).toMatchObject({
  36 |       service: 'stellar-stream',
  37 |       status: 'ok',
  38 |     });
  39 |   });
  40 | });
  41 | 
```