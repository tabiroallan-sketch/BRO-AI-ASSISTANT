import { test, expect } from 'playwright/test';
import {
  cleanupUser,
  closePage,
  registerUser,
  signInViaApi,
  signInViaUi,
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

test('registers a new account through the UI and lands on the dashboard', async ({ page }) => {
  const email = `ui-reg-${Date.now()}@example.com`;
  const password = 'Ui-register-password-123';

  await page.goto('/register');
  await page.getByRole('main').getByLabel('Display name').fill('UI Register');
  await page.getByRole('main').getByLabel('Email').fill(email);
  await page.getByRole('main').getByLabel('Password').fill(password);
  await page.getByRole('main').getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('logs in with valid credentials', async ({ page }) => {
  await signInViaUi(page, user);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('shows an error for invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('main').getByLabel('Email').fill(user.email);
  await page.getByRole('main').getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('main').getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/Invalid email or password/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/login/);
});

test('protected pages redirect to login when unauthenticated', async ({ page }) => {
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
});

test('authenticated user can reach the chat page', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/chat');
  await expect(page.getByLabel('Message BRO')).toBeVisible({ timeout: 20_000 });
});
