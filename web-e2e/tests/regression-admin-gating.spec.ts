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

test('regression: a regular USER never sees admin-only navigation', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/dashboard');

  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
  await expect(sidebar.getByRole('link', { name: 'Automations' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Logs' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
});

for (const path of ['/dashboard/logs', '/dashboard/automations', '/dashboard/admin']) {
  test(`regression: ${path} blocks a non-admin user with a permission message`, async ({
    page,
  }) => {
    await signInViaApi(page, user);
    await page.goto(path);

    await expect(
      page.getByRole('main').getByText('You do not have permission to view this page.'),
    ).toBeVisible({ timeout: 20_000 });
  });
}
