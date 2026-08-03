import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserClickTool,
  browserCloseTool,
  browserDownloadTool,
  browserExtractTool,
  browserFillTool,
  browserNavigateTool,
  browserOpenTool,
  browserReadTool,
  browserScreenshotTool,
} from '../src/tools/browser.js';
import type { ToolContext } from '../src/tools/types.js';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.TOOL_FS_ROOT = join(tmpdir(), `agent-browser-tests-${process.pid}`);

type LocatorBehavior = {
  count: () => number;
  text: () => string;
  attr: (name: string) => string | null;
  click: () => Promise<void> | void;
  fill: (value: string) => Promise<void> | void;
  press: (key: string) => Promise<void> | void;
};

const state = vi.hoisted(() => {
  const defaultBehavior: LocatorBehavior = {
    count: () => 1,
    text: () => 'Sample text',
    attr: () => 'value',
    click: async () => undefined,
    fill: async () => undefined,
    press: async () => undefined,
  };

  const fakeLocator = (): Record<string, unknown> => ({
    count: async () => state.behaviorFor('').count(),
    first: () => fakeLocator(),
    nth: () => fakeLocator(),
    click: async () => state.behaviorFor('').click(),
    fill: async (value: string) => state.behaviorFor('').fill(value),
    press: async (key: string) => state.behaviorFor('').press(key),
    innerText: async () => state.behaviorFor('').text(),
    getAttribute: async (name: string) => state.behaviorFor('').attr(name),
    screenshot: async () => undefined,
  });

  const makePage = (): Record<string, unknown> => ({
    url: () => 'https://example.com/page',
    title: async () => 'Example',
    goto: async (_url: string, _opts?: Record<string, unknown>) => ({ status: () => 200 }),
    goBack: async () => null,
    goForward: async () => null,
    reload: async () => null,
    waitForTimeout: async () => undefined,
    locator: () => fakeLocator(),
    getByText: () => fakeLocator(),
    getByRole: () => fakeLocator(),
    getByLabel: () => fakeLocator(),
    screenshot: async (_opts: Record<string, unknown>) => undefined,
    waitForEvent: async () => state.download,
  });

  const state = {
    behaviorFor: (_selector: string): LocatorBehavior => defaultBehavior,
    defaultBehavior,
    lastSaveAs: '',
    browser: null as unknown,
    context: null as unknown,
    page: null as unknown,
    download: {
      suggestedFilename: (): string => 'report.pdf',
      saveAs: async (path: string): Promise<void> => {
        state.lastSaveAs = path;
      },
    },
    makePage,
  };
  return state;
});

vi.mock('playwright', () => ({
  chromium: {
    executablePath: (): string => join(tmpdir(), 'fake-chrome.exe'),
    launch: async (): Promise<unknown> => state.browser,
  },
}));

vi.mock('../src/browser/index.js', () => ({
  isBrowserAvailable: (): boolean => true,
  getBrowser: async (): Promise<unknown> => state.browser,
  stopBrowser: async (): Promise<void> => undefined,
}));

beforeEach(async () => {
  state.behaviorFor = (_selector: string): LocatorBehavior => state.defaultBehavior;
  state.lastSaveAs = '';
  state.page = state.makePage();
  state.context = {
    browser: (): unknown => state.browser,
    setDefaultTimeout: (): void => undefined,
    setDefaultNavigationTimeout: (): void => undefined,
    close: async (): Promise<void> => undefined,
    newPage: async (): Promise<unknown> => state.page,
  };
  state.browser = {
    newContext: async (): Promise<unknown> => state.context,
    isConnected: (): boolean => true,
    close: async (): Promise<void> => undefined,
  };
});

const context: ToolContext = { userId: `user-${randomUUID()}` };

describe('browser tools', () => {
  it('opens a URL and returns the title and final URL', async () => {
    const result = await browserOpenTool.execute({ url: 'https://example.com' }, context);
    expect(result).toContain('Opened https://example.com');
    expect(result).toContain('Title: Example');
    expect(result).toContain('Final URL: https://example.com/page');
  });

  it('rejects an invalid URL when opening', async () => {
    await expect(browserOpenTool.execute({ url: 'not a url' }, context)).rejects.toThrow(
      'not a valid http(s) URL',
    );
  });

  it('navigates back, forward and reloads', async () => {
    for (const action of ['back', 'forward', 'reload', 'goto']) {
      const result = await browserNavigateTool.execute(
        { action, url: 'https://example.com/other' },
        context,
      );
      expect(result).toContain(`Navigated (${action})`);
      expect(result).toContain('Title: Example');
    }
  });

  it('rejects an unknown navigation action', async () => {
    await expect(browserNavigateTool.execute({ action: 'sideways' }, context)).rejects.toThrow(
      'Unknown navigation action',
    );
  });

  it('reads the page text and truncates when maxChars is set', async () => {
    state.behaviorFor = (_selector: string): LocatorBehavior => ({
      ...state.defaultBehavior,
      text: (): string => 'a'.repeat(100),
    });
    const result = await browserReadTool.execute({ maxChars: 50 }, context);
    expect(result).toContain('URL: https://example.com/page');
    expect(result).toContain('Title: Example');
    expect(result).toContain('truncated');

    const full = await browserReadTool.execute({ maxChars: 100000 }, context);
    expect(full).toContain('a'.repeat(100));
  });

  it('reads a specific selector', async () => {
    const result = await browserReadTool.execute({ selector: '#main' }, context);
    expect(result).toContain('Sample text');
  });

  it('clicks by selector and by text', async () => {
    const clicked: Array<Record<string, unknown>> = [];
    state.behaviorFor = (_selector: string): LocatorBehavior => ({
      ...state.defaultBehavior,
      click: async (): Promise<void> => {
        clicked.push({ at: Date.now() });
      },
    });
    const bySelector = await browserClickTool.execute({ selector: '#submit' }, context);
    expect(bySelector).toContain('Clicked');

    const byText = await browserClickTool.execute({ text: 'Log in' }, context);
    expect(byText).toContain('Log in');
    expect(clicked.length).toBe(2);
  });

  it('errors when clicking without a target', async () => {
    await expect(browserClickTool.execute({}, context)).rejects.toThrow(
      'Provide a "selector", a "text", or a "role"',
    );
  });

  it('fills a field by selector and by label', async () => {
    const fills: string[] = [];
    state.behaviorFor = (_selector: string): LocatorBehavior => ({
      ...state.defaultBehavior,
      fill: async (value: string): Promise<void> => {
        fills.push(value);
      },
    });
    const bySelector = await browserFillTool.execute(
      { selector: 'input[name=q]', value: 'playwright' },
      context,
    );
    expect(bySelector).toContain('Filled selector "input[name=q]"');

    const byLabel = await browserFillTool.execute(
      { label: 'Search', value: 'docs', pressEnter: true },
      context,
    );
    expect(byLabel).toContain('pressed Enter');
    expect(fills).toEqual(['playwright', 'docs']);
  });

  it('requires a value and a target when filling', async () => {
    await expect(browserFillTool.execute({ label: 'Search' }, context)).rejects.toThrow(
      'A "value" to enter is required',
    );
    await expect(browserFillTool.execute({ value: 'x' }, context)).rejects.toThrow(
      'Provide a "selector" or a "label"',
    );
  });

  it('takes a screenshot and reports the saved path', async () => {
    const result = await browserScreenshotTool.execute({ name: 'landing' }, context);
    expect(result).toContain('Saved screenshot to');
    expect(result).toContain('landing.png');
  });

  it('extracts attributes from matching elements with a cap', async () => {
    state.behaviorFor = (_selector: string): LocatorBehavior => ({
      ...state.defaultBehavior,
      count: (): number => 3,
      attr: (name: string): string | null => (name === 'href' ? 'https://example.com/link' : null),
    });
    const result = await browserExtractTool.execute(
      { selector: 'a', attribute: 'href', maxItems: 2 },
      context,
    );
    const payload = JSON.parse(result);
    expect(payload.matched).toBe(3);
    expect(payload.returned).toBe(2);
    expect(payload.values).toEqual(['https://example.com/link', 'https://example.com/link']);
  });

  it('reports when no elements match for extraction', async () => {
    state.behaviorFor = (_selector: string): LocatorBehavior => ({
      ...state.defaultBehavior,
      count: (): number => 0,
    });
    const result = await browserExtractTool.execute(
      { selector: 'none', attribute: 'href' },
      context,
    );
    expect(result).toContain('No elements matched');
  });

  it('downloads a file by URL and by selector into the sandbox', async () => {
    const byUrl = await browserDownloadTool.execute(
      { url: 'https://example.com/report.pdf' },
      context,
    );
    expect(byUrl).toContain('Downloaded report.pdf');
    expect(byUrl).toContain('downloads');

    const bySelector = await browserDownloadTool.execute(
      { selector: 'a.download', name: 'custom' },
      context,
    );
    expect(bySelector).toContain('Downloaded report.pdf');
    expect(state.lastSaveAs).toContain('custom.pdf');
  });

  it('requires a url or selector for downloads', async () => {
    await expect(browserDownloadTool.execute({}, context)).rejects.toThrow(
      'Provide either a "url" to download or a "selector"',
    );
  });

  it('closes the browser session', async () => {
    await browserOpenTool.execute({ url: 'https://example.com' }, context);
    const result = await browserCloseTool.execute({}, context);
    expect(result).toBe('Browser session closed.');
  });
});
