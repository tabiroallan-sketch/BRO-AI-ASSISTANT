import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarListEventsTool } from '../src/tools/calendar.js';
import { discordSendMessageTool } from '../src/tools/discord.js';
import { githubCreateIssueTool, githubListReposTool } from '../src/tools/github.js';
import { gmailSendTool } from '../src/tools/gmail.js';
import { notionSearchPagesTool } from '../src/tools/notion.js';
import { slackSendMessageTool } from '../src/tools/slack.js';
import { whatsappSendMessageTool } from '../src/tools/whatsapp.js';
import type { ToolContext } from '../src/tools/types.js';

type MockFetchInit = {
  headers?: Record<string, string>;
  body?: string;
};

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';

type MockIntegration = {
  id: string;
  userId: string;
  provider: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
};

const { mockPrisma, resetDb, seedIntegration } = vi.hoisted(() => {
  const integrations = new Map<string, MockIntegration>();

  const integrationModel = {
    async findUnique(args: {
      where: { userId_provider: { userId: string; provider: string } };
    }): Promise<MockIntegration | null> {
      const key = `${args.where.userId_provider.userId}:${args.where.userId_provider.provider}`;
      return integrations.get(key) ?? null;
    },
    async upsert(args: {
      where: { userId_provider: { userId: string; provider: string } };
      update: Partial<MockIntegration>;
      create: MockIntegration;
    }): Promise<MockIntegration> {
      const { userId, provider } = args.where.userId_provider;
      const key = `${userId}:${provider}`;
      const existing = integrations.get(key);
      const record: MockIntegration = existing
        ? { ...existing, ...args.update, userId, provider }
        : { ...args.create, userId, provider };
      integrations.set(key, record);
      return record;
    },
  };

  function seedIntegration(
    userId: string,
    provider: string,
    accessToken: string,
    metadata: Record<string, unknown> | null = null,
  ): void {
    const key = `${userId}:${provider}`;
    integrations.set(key, {
      id: randomUUID(),
      userId,
      provider,
      accountName: null,
      externalId: null,
      accessToken,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: null,
      metadata,
    });
  }

  return {
    mockPrisma: {
      integration: integrationModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      integrations.clear();
    },
    seedIntegration,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

const USER_ID = 'user-1';

function context(): ToolContext {
  return { userId: USER_ID };
}

describe('integration tools', () => {
  beforeEach(() => {
    resetDb();
    vi.restoreAllMocks();
  });

  it('calendar_list_events warns when not connected', async () => {
    const tool = calendarListEventsTool;
    await expect(tool.execute({}, context())).rejects.toThrow(/not connected Google Calendar/);
  });

  it('calendar_list_events lists events from the Google Calendar API', async () => {
    seedIntegration(USER_ID, 'google-calendar', 'cal_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: '1',
                summary: 'Standup',
                description: 'Daily sync',
                start: { dateTime: '2026-08-04T09:00:00Z' },
                end: { dateTime: '2026-08-04T09:15:00Z' },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = calendarListEventsTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Standup');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/calendars/primary/events');
  });

  it('github_list_repos lists repositories', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([
            {
              full_name: 'octocat/Hello-World',
              description: 'My first repo',
              default_branch: 'main',
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListReposTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('octocat/Hello-World');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('api.github.com/user/repos');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer gh_token');
  });

  it('github_create_issue creates an issue', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            number: 42,
            title: 'Bug found',
            html_url: 'https://github.com/o/r/issues/42',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubCreateIssueTool;
    const result = await tool.execute(
      { repo: 'octocat/Hello-World', title: 'Bug found' },
      context(),
    );
    expect(result).toContain('#42');
    expect(result).toContain('Bug found');
  });

  it('slack_send_message surfaces a Slack API error', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackSendMessageTool;
    await expect(tool.execute({ channel: '#general', text: 'hello' }, context())).rejects.toThrow(
      /invalid_auth/,
    );
  });

  it('discord_send_message posts to the configured webhook', async () => {
    seedIntegration(USER_ID, 'discord', 'https://discord.com/api/webhooks/123/abc');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = discordSendMessageTool;
    const result = await tool.execute({ content: 'Hello Discord' }, context());
    expect(result).toContain('msg-1');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://discord.com/api/webhooks/123/abc?wait=true');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.content).toBe('Hello Discord');
  });

  it('whatsapp_send_message sends a WhatsApp message', async () => {
    seedIntegration(USER_ID, 'whatsapp', 'wa_token', { phoneNumberId: '123456789' });
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = whatsappSendMessageTool;
    const result = await tool.execute({ to: '+15551234567', body: 'Hello' }, context());
    expect(result).toContain('wamid.1');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://graph.facebook.com/v18.0/123456789/messages');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.to).toBe('+15551234567');
    expect(body.text.body).toBe('Hello');
  });

  it('notion_search_pages lists matching pages', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: 'page-1',
                last_edited_time: '2026-08-03T10:00:00.000Z',
                properties: { title: { type: 'title', title: [{ plain_text: 'Project Notes' }] } },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionSearchPagesTool;
    const result = await tool.execute({ query: 'project' }, context());
    expect(result).toContain('Project Notes');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/search');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer notion_token');
  });

  it('gmail_send sends a base64url-encoded message', async () => {
    seedIntegration(USER_ID, 'google-gmail', 'gmail_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ id: 'msg-2' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = gmailSendTool;
    const result = await tool.execute(
      { to: 'a@example.com', subject: 'Hi', body: 'Body text' },
      context(),
    );
    expect(result).toContain('msg-2');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(typeof body.raw).toBe('string');
    const decoded = Buffer.from(body.raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: a@example.com');
    expect(decoded).toContain('Body text');
  });
});
