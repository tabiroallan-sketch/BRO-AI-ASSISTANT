import { expect, type Page } from 'playwright/test';

const API = process.env.BRO_API_URL ?? 'http://localhost:3000/api/v1';

export type TestUser = {
  email: string;
  password: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
};

export async function registerUser(): Promise<TestUser> {
  const email = `ui-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
  const password = 'Ui-test-password-123';
  const displayName = 'UI Test';
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
  return {
    email,
    password,
    displayName,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
  };
}

export async function signInViaApi(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript(
    ({ access, refresh }: { access: string; refresh: string }) => {
      localStorage.setItem('bro.accessToken', access);
      localStorage.setItem('bro.refreshToken', refresh);
    },
    { access: user.accessToken, refresh: user.refreshToken },
  );
}

export async function signInViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByRole('main').getByLabel('Email').fill(user.email);
  await page.getByRole('main').getByLabel('Password').fill(user.password);
  await page.getByRole('main').getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

export async function dismissFloatingPanels(page: Page): Promise<void> {
  for (const name of ['Telemetry', 'Core', 'Status']) {
    await page.getByRole('button', { name: `Close ${name} panel` }).click();
  }
}

export async function cleanupUser(user: TestUser): Promise<void> {
  try {
    const response = await fetch(`${API}/conversations`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    const body = (await response.json()) as { conversations: Array<{ id: string }> };
    await Promise.all(
      (body.conversations ?? []).map((conversation) =>
        fetch(`${API}/conversations/${conversation.id}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${user.accessToken}` },
        }),
      ),
    );
  } catch {
    // Best-effort cleanup; failures must not fail the test.
  }
}

export async function closePage(page: Page): Promise<void> {
  await page.close().catch(() => undefined);
}
