import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listUserIntegrations: vi.fn(),
  listTools: vi.fn(),
}));

vi.mock('../../src/integrations/providers.js', () => ({
  listProviders: mocks.listProviders,
}));
vi.mock('../../src/integrations/store.js', () => ({
  listUserIntegrations: mocks.listUserIntegrations,
}));
vi.mock('../../src/tools/registry.js', () => ({
  listTools: mocks.listTools,
}));

type AwarenessModule = typeof import('../../src/llm/integration-awareness.js');

describe('integration awareness', () => {
  let awareness: AwarenessModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    awareness = await import('../../src/llm/integration-awareness.js');
  });

  function tools(...entries: Array<[string, string]>): Array<{ name: string; providerId: string }> {
    return entries.map(([name, providerId]) => ({ name, providerId }));
  }

  it('groups tools by provider and separates connected from available', async () => {
    mocks.listTools.mockReturnValue(
      tools(
        ['gmail_send', 'google-gmail'],
        ['gmail_search', 'google-gmail'],
        ['github_list_repos', 'github'],
        ['slack_send_message', 'slack'],
        ['notion_search_pages', 'notion'],
        ['current_time', undefined],
      ),
    );
    mocks.listProviders.mockReturnValue([
      { id: 'google-gmail', label: 'Gmail', type: 'oauth', oauthConfigured: true },
      { id: 'github', label: 'GitHub', type: 'oauth', oauthConfigured: true },
      { id: 'slack', label: 'Slack', type: 'oauth', oauthConfigured: false },
      { id: 'notion', label: 'Notion', type: 'oauth', oauthConfigured: true },
    ]);
    mocks.listUserIntegrations.mockResolvedValue(
      new Map([['google-gmail', { provider: 'google-gmail', accountName: 'alice@gmail.com' }]]),
    );

    const result = await awareness.buildIntegrationAwareness('user-1');

    expect(result.connected).toEqual([
      {
        providerId: 'google-gmail',
        label: 'Gmail',
        tools: ['gmail_search', 'gmail_send'],
        accountName: 'alice@gmail.com',
      },
    ]);
    expect(result.available.map((group) => group.providerId).sort()).toEqual(['github', 'notion']);
    expect(result.unavailable.map((group) => group.providerId)).toEqual(['slack']);
  });

  it('formats the connected and available sections for the system prompt', () => {
    const text = awareness.formatIntegrationAwareness({
      connected: [
        { providerId: 'google-gmail', label: 'Gmail', tools: ['gmail_send'], accountName: 'a@b.c' },
      ],
      available: [{ providerId: 'github', label: 'GitHub', tools: ['github_list_repos'] }],
      unavailable: [],
    });

    expect(text).toContain('Connected accounts you can act on directly');
    expect(text).toContain('- Gmail (a@b.c): gmail_send');
    expect(text).toContain('NOT connected yet');
    expect(text).toContain('- GitHub: github_list_repos');
    expect(text).toContain('Connect button');
  });

  it('returns an empty prompt block when there is nothing to report', () => {
    expect(
      awareness.formatIntegrationAwareness({ connected: [], available: [], unavailable: [] }),
    ).toBe('');
  });
});
