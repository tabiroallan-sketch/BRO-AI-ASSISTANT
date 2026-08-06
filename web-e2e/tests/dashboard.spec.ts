import { test, expect } from 'playwright/test';
import {
  cleanupUser,
  closePage,
  dismissFloatingPanels,
  registerUser,
  signInViaApi,
  type TestUser,
} from '../helpers';

let user: TestUser;

test.beforeEach(async () => {
  user = await registerUser();
});

test.afterEach(async ({ page }) => {
  await closePage(page);
  await cleanupUser(user);
});

test('dashboard overview loads with stat cards and navigation', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Marketplace', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Health', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connected accounts', exact: true })).toBeVisible();
});

test('sidebar navigates across dashboard sections', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/dashboard');
  await dismissFloatingPanels(page);

  await page.getByRole('link', { name: 'Marketplace', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/integrations/);
  await expect(page.getByRole('heading', { name: 'Integration Marketplace' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('link', { name: 'Health', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/health/);
  await expect(page.getByRole('heading', { name: 'Connection Health' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
});
