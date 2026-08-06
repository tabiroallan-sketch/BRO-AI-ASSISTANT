import { test, expect } from 'playwright/test';
import { cleanupUser, closePage, registerUser, signInViaApi, type TestUser } from '../helpers';

let user: TestUser;

test.beforeEach(async () => {
  user = await registerUser();
});

test.afterEach(async ({ page }) => {
  await closePage(page);
  await cleanupUser(user);
});

test('integration hub lists providers from the live backend', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/dashboard/integrations');

  await expect(page.getByRole('heading', { name: 'Integration Marketplace' })).toBeVisible({
    timeout: 20_000,
  });

  const hubCard = page.getByText('Google', { exact: true }).first();
  await expect(hubCard).toBeVisible({ timeout: 20_000 });
});

test('connection health page renders provider rows', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/dashboard/health');

  await expect(page.getByRole('heading', { name: 'Connection Health' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Not connected/i).first()).toBeVisible({ timeout: 20_000 });
});
