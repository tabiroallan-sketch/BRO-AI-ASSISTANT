import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { config } from '../config/index.js';

let browserPromise: Promise<Browser> | null = null;
let launchError: string | null = null;

export function isBrowserAvailable(): boolean {
  if (!config.browserEnabled) {
    return false;
  }
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export function browserUnavailableReason(): string {
  if (!config.browserEnabled) {
    return 'Browser automation is disabled (set BROWSER_ENABLED=true to enable it).';
  }
  return 'Chromium is not installed. Run "npx playwright install chromium" (or rebuild the Docker image) to enable browser automation.';
}

export async function getBrowser(): Promise<Browser> {
  if (!isBrowserAvailable()) {
    throw new Error(browserUnavailableReason());
  }
  if (browserPromise) {
    return browserPromise;
  }
  if (launchError) {
    throw new Error(launchError);
  }
  browserPromise = chromium
    .launch({
      headless: config.browserHeadless,
      ...(config.browserNoSandbox ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {}),
    })
    .catch((error) => {
      launchError = `Failed to launch Chromium: ${error instanceof Error ? error.message : String(error)}`;
      browserPromise = null;
      throw new Error(launchError);
    });
  return browserPromise;
}

export async function stopBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
  launchError = null;
}
