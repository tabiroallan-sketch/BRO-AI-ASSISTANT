import { basename, extname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Locator, Page } from 'playwright';
import type { Tool } from './types.js';
import { getPage, closeSession } from '../browser/sessions.js';
import { browserUnavailableReason, isBrowserAvailable } from '../browser/index.js';
import { ensureSandboxDir, resolveSandboxPath } from './sandbox.js';

function requireBrowser(): void {
  if (!isBrowserAvailable()) {
    throw new Error(browserUnavailableReason());
  }
}

function argString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function argNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeName(name: string): string {
  let cleaned = '';
  for (const char of name) {
    cleaned += char.charCodeAt(0) < 0x20 ? '_' : char;
  }
  cleaned = cleaned
    .replace(/[\\/:*?"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^_+|_+$/g, '');
  return cleaned || 'download';
}

function clampChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated, ${text.length - maxChars} more characters]`;
}

async function waitForSettle(page: Page, waitMs?: number): Promise<void> {
  if (typeof waitMs === 'number' && waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

async function readPageText(page: Page, selector?: string): Promise<string> {
  if (selector) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) {
      return `(no element matches selector "${selector}")`;
    }
    return (await locator.first().innerText()) ?? '';
  }
  const locator = page.locator('body');
  if ((await locator.count()) === 0) {
    return '';
  }
  return (await locator.first().innerText()) ?? '';
}

export const browserOpenTool: Tool = {
  name: 'browser_open',
  description:
    "Open a website in the user's browser session and wait for it to load. Provide a full http(s) URL. The session remembers its current page, so subsequent browser_* calls act on the same tab. Returns the final URL and page title.",
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to open, e.g. "https://example.com".' },
      waitMs: {
        type: 'number',
        description: 'Optional extra time to wait after load (milliseconds) for dynamic content.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional navigation timeout in milliseconds (default 30000).',
      },
    },
    required: ['url'],
  },
  async execute(args, context) {
    const url = argString(args.url);
    if (!url) {
      throw new Error('A "url" is required, e.g. "https://example.com".');
    }
    if (!validUrl(url)) {
      throw new Error(`"${url}" is not a valid http(s) URL.`);
    }
    requireBrowser();
    const page = await getPage(context.userId);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: argNumber(args.timeoutMs, 30_000),
    });
    await waitForSettle(page, argNumber(args.waitMs, 0));
    const title = await page.title().catch(() => '');
    return `Opened ${url}\nTitle: ${title}\nFinal URL: ${page.url()}`;
  },
};

export const browserNavigateTool: Tool = {
  name: 'browser_navigate',
  description:
    'Navigate the current browser tab: go back, go forward, reload the page, or go to a new URL. Uses the existing browser session. Returns the URL and page title after navigating.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'One of: "back", "forward", "reload", "goto".',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to when action is "goto".',
      },
      waitMs: {
        type: 'number',
        description: 'Optional extra time to wait after load (milliseconds) for dynamic content.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional navigation timeout in milliseconds (default 30000).',
      },
    },
    required: ['action'],
  },
  async execute(args, context) {
    const action = argString(args.action) ?? '';
    const url = argString(args.url);
    if (action === 'goto') {
      if (!url) {
        throw new Error('An "url" is required when action is "goto".');
      }
      if (!validUrl(url)) {
        throw new Error(`"${url}" is not a valid http(s) URL.`);
      }
    }
    requireBrowser();
    const page = await getPage(context.userId);

    if (action === 'back') {
      await page.goBack({ timeout: argNumber(args.timeoutMs, 30_000) });
    } else if (action === 'forward') {
      await page.goForward({ timeout: argNumber(args.timeoutMs, 30_000) });
    } else if (action === 'reload') {
      await page.reload({ timeout: argNumber(args.timeoutMs, 30_000) });
    } else if (action === 'goto') {
      await page.goto(url as string, {
        waitUntil: 'domcontentloaded',
        timeout: argNumber(args.timeoutMs, 30_000),
      });
    } else {
      throw new Error(`Unknown navigation action "${action}". Use back, forward, reload or goto.`);
    }

    await waitForSettle(page, argNumber(args.waitMs, 0));
    const title = await page.title().catch(() => '');
    return `Navigated (${action})\nTitle: ${title}\nURL: ${page.url()}`;
  },
};

export const browserReadTool: Tool = {
  name: 'browser_read',
  description:
    'Read the visible text of the current page (or a specific element). Returns the page URL, title, and the visible text content. Use to understand what is on a page before interacting with it.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Optional CSS selector. If omitted, the whole page body is read.',
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters of text to return (default 8000).',
      },
    },
  },
  async execute(args, context) {
    const selector = argString(args.selector);
    const maxChars = Math.max(1, argNumber(args.maxChars, 8000));
    requireBrowser();
    const page = await getPage(context.userId);
    const text = await readPageText(page, selector);
    const title = await page.title().catch(() => '');
    const output = clampChars(text, maxChars);
    return `URL: ${page.url()}\nTitle: ${title}\n\n${output}`;
  },
};

function clickTarget(args: Record<string, unknown>): {
  selector?: string;
  text?: string;
  role?: string;
} {
  return {
    selector: argString(args.selector),
    text: argString(args.text),
    role: argString(args.role),
  };
}

async function resolveClickLocator(page: Page, args: Record<string, unknown>): Promise<Locator> {
  const { selector, text, role } = clickTarget(args);
  if (selector) {
    return page.locator(selector).first();
  }
  if (text) {
    return page.getByText(text, { exact: false }).first();
  }
  if (role) {
    return page.getByRole(role as 'button' | 'link' | 'textbox', { name: text }).first();
  }
  throw new Error('Provide a "selector", a "text", or a "role" to click.');
}

export const browserClickTool: Tool = {
  name: 'browser_click',
  description:
    'Click a button, link or element on the current page. Target by CSS selector ("selector"), by visible text ("text"), or by accessibility role plus name ("role"). Waits briefly for the click to take effect.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the element to click, e.g. "#submit" or "a[href*=login]".',
      },
      text: {
        type: 'string',
        description:
          'Visible text to click, e.g. "Log in". Matches the first element containing the text.',
      },
      role: {
        type: 'string',
        description: 'Accessibility role, e.g. "button", "link" or "textbox".',
      },
      name: {
        type: 'string',
        description: 'Accessible name to match when a "role" is given.',
      },
      waitMs: {
        type: 'number',
        description: 'Optional time to wait after clicking (milliseconds) for the page to update.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional wait timeout in milliseconds (default 30000).',
      },
    },
  },
  async execute(args, context) {
    requireBrowser();
    const page = await getPage(context.userId);
    const clickArgs = { ...args, text: argString(args.text) ?? argString(args.name) };
    const locator = await resolveClickLocator(page, clickArgs);
    await locator.click({ timeout: argNumber(args.timeoutMs, 30_000) });
    await waitForSettle(page, argNumber(args.waitMs, 500));
    const title = await page.title().catch(() => '');
    return `Clicked ${JSON.stringify({ selector: argString(args.selector), text: clickArgs.text, role: argString(args.role) })}\nTitle: ${title}\nURL: ${page.url()}`;
  },
};

export const browserFillTool: Tool = {
  name: 'browser_fill',
  description:
    'Fill a form field (text input, textarea or contenteditable) on the current page with a value, and optionally press Enter afterwards (useful for search boxes). Target by CSS selector, by label text ("label"), or by placeholder.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the input, e.g. "input[name=q]" or "#search".',
      },
      label: {
        type: 'string',
        description: 'Accessible label or placeholder text of the field, e.g. "Search".',
      },
      value: {
        type: 'string',
        description: 'Text to enter into the field.',
      },
      pressEnter: {
        type: 'boolean',
        description: 'Set to true to press Enter after filling (default false).',
      },
      waitMs: {
        type: 'number',
        description: 'Optional time to wait after filling (milliseconds).',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional wait timeout in milliseconds (default 30000).',
      },
    },
    required: ['value'],
  },
  async execute(args, context) {
    const value = argString(args.value);
    if (value === undefined) {
      throw new Error('A "value" to enter is required.');
    }
    const selector = argString(args.selector);
    const label = argString(args.label);
    if (!selector && !label) {
      throw new Error('Provide a "selector" or a "label" for the field.');
    }
    requireBrowser();
    const page = await getPage(context.userId);
    const timeout = argNumber(args.timeoutMs, 30_000);
    const locator = selector
      ? page.locator(selector).first()
      : page.getByLabel(label as string).first();
    await locator.fill(value, { timeout });
    if (args.pressEnter === true) {
      await locator.press('Enter', { timeout });
    }
    await waitForSettle(page, argNumber(args.waitMs, 0));
    return `Filled ${selector ? `selector "${selector}"` : `field "${label}"`}${args.pressEnter === true ? ' and pressed Enter' : ''}.`;
  },
};

export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description:
    'Take a screenshot of the current page (or a specific element) and save it into the user\'s sandbox under "screenshots/". Returns the saved filename and full path so it can be shared with the user.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Optional filename (without extension). Defaults to a timestamped name.',
      },
      selector: {
        type: 'string',
        description:
          'Optional CSS selector to screenshot just that element instead of the full viewport.',
      },
      fullPage: {
        type: 'boolean',
        description: 'Set to true to capture the entire scrollable page (default false).',
      },
    },
  },
  async execute(args, context) {
    requireBrowser();
    const page = await getPage(context.userId);
    const dir = join(ensureSandboxDir(context.userId), 'screenshots');
    await mkdir(dir, { recursive: true });
    const base = sanitizeName(argString(args.name) ?? `page-${Date.now()}`);
    const filePath = resolveSandboxPath(context.userId, join('screenshots', `${base}.png`));
    const selector = argString(args.selector);
    if (selector) {
      const locator = page.locator(selector).first();
      await locator.screenshot({ path: filePath });
    } else {
      await page.screenshot({
        path: filePath,
        fullPage: args.fullPage === true,
      });
    }
    return `Saved screenshot to ${filePath}`;
  },
};

export const browserExtractTool: Tool = {
  name: 'browser_extract',
  description:
    'Extract data from matching elements on the current page: text content, or a specific attribute/href for every match. Use a CSS selector to target elements, e.g. "a" or "table tr". Returns a JSON list of extracted values.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the elements to extract from.',
      },
      attribute: {
        type: 'string',
        description: 'Optional attribute to extract instead of text, e.g. "href" or "src".',
      },
      maxItems: {
        type: 'number',
        description: 'Maximum number of elements to return (default 50).',
      },
    },
    required: ['selector'],
  },
  async execute(args, context) {
    const selector = argString(args.selector);
    if (!selector) {
      throw new Error('A "selector" is required.');
    }
    const attribute = argString(args.attribute);
    const maxItems = Math.max(1, argNumber(args.maxItems, 50));
    requireBrowser();
    const page = await getPage(context.userId);
    const locator = page.locator(selector);
    const count = await locator.count();
    const results: string[] = [];
    const limit = Math.min(count, maxItems);
    for (let i = 0; i < limit; i += 1) {
      const el = locator.nth(i);
      const value = attribute ? await el.getAttribute(attribute) : ((await el.innerText()) ?? '');
      results.push(value ?? '');
    }
    if (count === 0) {
      return `No elements matched selector "${selector}".`;
    }
    const payload = {
      selector,
      matched: count,
      returned: results.length,
      values: results,
    };
    return JSON.stringify(payload, null, 2);
  },
};

export const browserDownloadTool: Tool = {
  name: 'browser_download',
  description:
    'Download a file with the browser session. Either give a direct "url" to a file, or a "selector" pointing to a download link/button on the current page. Files are saved into the user\'s sandbox under "downloads/". Returns the saved filename.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Direct URL of the file to download, e.g. "https://example.com/report.pdf".',
      },
      selector: {
        type: 'string',
        description: 'CSS selector of a download link/button on the current page to click.',
      },
      name: {
        type: 'string',
        description:
          'Optional filename to save the file as (extension is added automatically if missing).',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional wait timeout in milliseconds (default 30000).',
      },
    },
  },
  async execute(args, context) {
    const url = argString(args.url);
    const selector = argString(args.selector);
    if (!url && !selector) {
      throw new Error('Provide either a "url" to download or a "selector" of a download link.');
    }
    if (url && !validUrl(url)) {
      throw new Error(`"${url}" is not a valid http(s) URL.`);
    }
    requireBrowser();
    const page = await getPage(context.userId);
    const timeout = argNumber(args.timeoutMs, 30_000);

    const downloadPromise = page.waitForEvent('download', { timeout });
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => undefined);
    } else if (selector) {
      await page.locator(selector).first().click({ timeout });
    }
    const download = await downloadPromise;

    const suggested = sanitizeName(download.suggestedFilename());
    const desired = argString(args.name);
    let filename = suggested;
    if (desired) {
      const base = sanitizeName(desired);
      const ext = extname(suggested);
      filename = extname(base) ? base : `${base}${ext}`;
    }

    const dir = join(ensureSandboxDir(context.userId), 'downloads');
    await mkdir(dir, { recursive: true });
    const filePath = resolveSandboxPath(context.userId, join('downloads', basename(filename)));
    await download.saveAs(filePath);
    return `Downloaded ${download.suggestedFilename()} to ${filePath}`;
  },
};

export const browserCloseTool: Tool = {
  name: 'browser_close',
  description:
    "Close the user's browser session and release its memory. The next browser_* call opens a fresh session. Use this when finished browsing.",
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args, context) {
    requireBrowser();
    await closeSession(context.userId);
    return 'Browser session closed.';
  },
};
