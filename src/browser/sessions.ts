import type { BrowserContext, Page } from 'playwright';
import { config } from '../config/index.js';
import { getBrowser, stopBrowser } from './index.js';

type Session = {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
};

const sessions = new Map<string, Session>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function scheduleCleanup(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions.entries()) {
      if (now - session.lastUsed > config.browserIdleTimeoutMs) {
        void closeSession(userId);
      }
    }
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 60_000);
  cleanupTimer.unref?.();
}

export async function getPage(userId: string): Promise<Page> {
  const existing = sessions.get(userId);
  if (existing) {
    if (existing.context.browser()?.isConnected()) {
      existing.lastUsed = Date.now();
      return existing.page;
    }
    sessions.delete(userId);
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  });
  context.setDefaultTimeout(config.browserTimeout);
  context.setDefaultNavigationTimeout(config.browserTimeout);
  const page = await context.newPage();
  sessions.set(userId, { context, page, lastUsed: Date.now() });
  scheduleCleanup();
  return page;
}

export async function closeSession(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session) {
    return;
  }
  sessions.delete(userId);
  await session.context.close().catch(() => undefined);
}

export async function closeAllSessions(): Promise<void> {
  for (const userId of [...sessions.keys()]) {
    await closeSession(userId);
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export async function shutdownBrowser(): Promise<void> {
  await closeAllSessions();
  await stopBrowser();
}
