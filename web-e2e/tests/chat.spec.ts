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

test('chat page renders the composer, sidebar, and new-chat action', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/chat');

  const composer = page.getByLabel('Message BRO');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();

  const send = page.getByRole('button', { name: 'Send message' });
  await expect(send).toBeDisabled();
  await composer.fill('Hello BRO');
  await expect(send).toBeEnabled();
});

test('a fresh user sees the empty state and no conversations', async ({ page }) => {
  await signInViaApi(page, user);
  await page.goto('/chat');

  await expect(page.getByText('Start a conversation with BRO')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('No conversations yet.')).toBeVisible();
});
