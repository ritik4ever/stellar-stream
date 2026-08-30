import { test, expect } from '@playwright/test';

test.describe('StellarStream E2E', () => {
  test('homepage loads and displays app branding', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('StellarStream');
    await expect(page.locator('text=Soroban-native MVP')).toBeVisible();
  });

  test('backend health endpoint responds successfully', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      service: 'stellar-stream-backend',
      status: 'ok',
    });
  });
});
