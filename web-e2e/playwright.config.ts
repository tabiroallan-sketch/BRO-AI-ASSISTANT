import { defineConfig } from 'playwright/test';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'off',
    launchOptions: {
      args: ['--disable-gpu', '--disable-software-rasterizer'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
