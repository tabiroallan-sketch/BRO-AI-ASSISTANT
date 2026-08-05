import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarListEventsTool } from '../src/tools/calendar.js';
import { contactsSearchTool } from '../src/tools/contacts.js';
import { discordSendMessageTool } from '../src/tools/discord.js';
import { docsReadTool, docsSearchTool } from '../src/tools/docs.js';
import { driveReadFileTool, driveUploadFileTool } from '../src/tools/drive.js';
import { githubCreateIssueTool, githubListReposTool } from '../src/tools/github.js';
import {
  githubListCommitsTool,
  githubListIssuesTool,
  githubListPullsTool,
  githubListReleasesTool,
  githubListWorkflowRunsTool,
  githubProfileTool,
} from '../src/tools/github.js';
import { gmailReadTool, gmailSendTool } from '../src/tools/gmail.js';
import {
  notionCreatePageTool,
  notionSearchDatabasesTool,
  notionSearchPagesTool,
  notionUpdatePageTool,
  notionWorkspaceTool,
} from '../src/tools/notion.js';
import { sheetsListTool, sheetsReadTool } from '../src/tools/sheets.js';
import {
  slackGetStatusTool,
  slackListChannelsTool,
  slackListUsersTool,
  slackReadMessagesTool,
  slackReadThreadTool,
  slackSendMessageTool,
  slackSetStatusTool,
} from '../src/tools/slack.js';
import { tasksCreateTool, tasksListTool } from '../src/tools/tasks.js';
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
  accountKey: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  createdAt: Date;
};

const { mockPrisma, resetDb, seedIntegration } = vi.hoisted(() => {
  const integrations = new Map<string, MockIntegration>();

  type MockPermissionSet = {
    id: string;
    integrationId: string;
    scopes: string[];
    permissionIds: string[];
    grantedAt: Date;
    updatedAt: Date;
  };
  const permissionSets = new Map<string, MockPermissionSet>();

  const integrationModel = {
    async findUnique(args: {
      where: {
        userId_provider_accountKey?: { userId: string; provider: string; accountKey: string };
      };
    }): Promise<MockIntegration | null> {
      const key = args.where.userId_provider_accountKey
        ? `${args.where.userId_provider_accountKey.userId}:${args.where.userId_provider_accountKey.provider}:${args.where.userId_provider_accountKey.accountKey}`
        : '';
      return integrations.get(key) ?? null;
    },
    async findFirst(args: {
      where?: { userId?: string; provider?: string; isPrimary?: boolean; id?: string };
      orderBy?: { createdAt?: string };
    }): Promise<MockIntegration | null> {
      const list = [...integrations.values()].filter(
        (record) =>
          (!args.where?.userId || record.userId === args.where.userId) &&
          (!args.where?.provider || record.provider === args.where.provider) &&
          (args.where?.isPrimary === undefined || record.isPrimary === args.where.isPrimary) &&
          (!args.where?.id || record.id === args.where.id),
      );
      if (args.orderBy?.createdAt === 'desc') {
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return list[0] ?? null;
    },
    async upsert(args: {
      where: {
        userId_provider_accountKey?: { userId: string; provider: string; accountKey: string };
      };
      update: Partial<MockIntegration>;
      create: MockIntegration;
    }): Promise<MockIntegration> {
      const { userId, provider, accountKey } = args.where.userId_provider_accountKey ?? {
        userId: args.create.userId,
        provider: args.create.provider,
        accountKey: args.create.accountKey,
      };
      const key = `${userId}:${provider}:${accountKey}`;
      const existing = integrations.get(key);
      const record: MockIntegration = existing
        ? { ...existing, ...args.update, userId, provider, accountKey }
        : { ...args.create, userId, provider, accountKey };
      integrations.set(key, record);
      return record;
    },
  };

  function seedIntegration(
    userId: string,
    provider: string,
    accessToken: string,
    metadata: Record<string, unknown> | null = null,
    scopes: string | null = null,
    permissionIds: string[] | null = null,
  ): void {
    const key = `${userId}:${provider}:default`;
    const id = randomUUID();
    integrations.set(key, {
      id,
      userId,
      provider,
      accountKey: 'default',
      accountName: null,
      externalId: null,
      accessToken,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes,
      metadata,
      isPrimary: true,
      createdAt: new Date(),
    });
    if (permissionIds !== null) {
      permissionSets.set(id, {
        id: randomUUID(),
        integrationId: id,
        scopes: scopes?.split(/\s+/).filter(Boolean) ?? [],
        permissionIds,
        grantedAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  const permissionSetModel = {
    async findUnique(args: {
      where: { integrationId: string };
    }): Promise<MockPermissionSet | null> {
      return permissionSets.get(args.where.integrationId) ?? null;
    },
  };

  return {
    mockPrisma: {
      integration: integrationModel,
      permissionSet: permissionSetModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    resetDb: (): void => {
      integrations.clear();
      permissionSets.clear();
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

  it('github_list_issues lists issues excluding pull requests', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([
            {
              number: 7,
              title: 'Login broken',
              state: 'open',
              html_url: 'https://github.com/o/r/issues/7',
              user: { login: 'octocat' },
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListIssuesTool;
    const result = await tool.execute({ repo: 'octocat/Hello-World' }, context());
    expect(result).toContain('#7');
    expect(result).toContain('Login broken');
    expect(result).toContain('octocat');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/repos/octocat/Hello-World/issues');
    expect(String(input)).toContain('state=open');
    expect(String(input)).toContain('type=issue');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer gh_token');
  });

  it('github_list_pulls lists pull requests', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([
            {
              number: 12,
              title: 'Add checkout flow',
              state: 'open',
              html_url: 'https://github.com/o/r/pulls/12',
              user: { login: 'octocat' },
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListPullsTool;
    const result = await tool.execute({ repo: 'octocat/Hello-World' }, context());
    expect(result).toContain('#12');
    expect(result).toContain('Add checkout flow');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/repos/octocat/Hello-World/pulls');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer gh_token');
  });

  it('github_list_workflow_runs lists recent Actions runs', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            workflow_runs: [
              {
                run_number: 88,
                name: 'CI',
                head_branch: 'main',
                status: 'completed',
                conclusion: 'success',
                created_at: '2026-08-05T08:00:00Z',
                html_url: 'https://github.com/o/r/actions/runs/88',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListWorkflowRunsTool;
    const result = await tool.execute({ repo: 'octocat/Hello-World' }, context());
    expect(result).toContain('Run #88');
    expect(result).toContain('CI');
    expect(result).toContain('main');
    expect(result).toContain('success');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/repos/octocat/Hello-World/actions/runs');
  });

  it('github_list_commits lists recent commits for a branch', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([
            {
              sha: 'a1b2c3d4e5f6',
              html_url: 'https://github.com/o/r/commit/a1b2c3d',
              commit: {
                message: 'Fix flaky test\n\nDetails here',
                author: { name: 'octocat', date: '2026-08-05T09:00:00Z' },
              },
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListCommitsTool;
    const result = await tool.execute({ repo: 'octocat/Hello-World', branch: 'main' }, context());
    expect(result).toContain('a1b2c3d');
    expect(result).toContain('Fix flaky test');
    expect(result).toContain('octocat');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/repos/octocat/Hello-World/commits');
    expect(String(input)).toContain('sha=main');
  });

  it('github_list_releases lists releases', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v1.2.0',
              name: 'Major refresh',
              published_at: '2026-08-01T00:00:00Z',
              html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubListReleasesTool;
    const result = await tool.execute({ repo: 'octocat/Hello-World' }, context());
    expect(result).toContain('v1.2.0');
    expect(result).toContain('Major refresh');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/repos/octocat/Hello-World/releases');
  });

  it('github_profile shows username, repository count, and permissions', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token', null, 'repo read:user');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            login: 'octocat',
            name: 'Mona Lisa',
            public_repos: 4,
            total_private_repos: 2,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = githubProfileTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Username: octocat');
    expect(result).toContain('Mona Lisa');
    expect(result).toContain('Repository count: 6');
    expect(result).toContain('4 public, 2 private');
    expect(result).toContain('Repositories');
    expect(result).toContain('Pull Requests');
    expect(result).toContain('Commits');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.github.com/user');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer gh_token');
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

  it('slack_send_message replies inside a thread with thread_ts', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ ok: true, channel: 'C123', ts: '9.9' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackSendMessageTool;
    const result = await tool.execute(
      { channel: '#general', text: 'reply', threadTs: '1234567890.000001' },
      context(),
    );
    expect(result).toContain('C123');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/chat.postMessage');
    const body = String(init?.body ?? '');
    expect(body).toContain('thread_ts=1234567890.000001');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer slack_token');
  });

  it('slack_list_channels lists public channels', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            channels: [
              {
                id: 'C123',
                name: 'general',
                num_members: 42,
                topic: { value: 'Company updates' },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackListChannelsTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('#general');
    expect(result).toContain('C123');
    expect(result).toContain('42');
    expect(result).toContain('Company updates');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/conversations.list');
    const body = String(init?.body ?? '');
    expect(body).toContain('types=public_channel');
  });

  it('slack_read_messages reads recent messages from a channel', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                user: 'U1',
                text: 'Morning all',
                ts: '123.1',
                reply_count: 2,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackReadMessagesTool;
    const result = await tool.execute({ channel: '#general' }, context());
    expect(result).toContain('Morning all');
    expect(result).toContain('thread: 2 replies');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/conversations.history');
    expect(String(init?.body ?? '')).toContain('channel=%23general');
  });

  it('slack_list_users lists workspace members', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            members: [
              {
                id: 'U1',
                name: 'jane',
                real_name: 'Jane Doe',
                is_bot: false,
                profile: {
                  real_name: 'Jane Doe',
                  email: 'jane@example.com',
                  status_text: 'In a meeting',
                  status_emoji: ':calendar:',
                },
              },
              { id: 'U2', name: 'bot', is_bot: true, profile: {} },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackListUsersTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('@jane');
    expect(result).toContain('Jane Doe');
    expect(result).toContain('jane@example.com');
    expect(result).toContain('In a meeting');
    expect(result).not.toContain('@bot');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/users.list');
  });

  it('slack_read_thread reads the parent message and replies', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { user: 'U1', text: 'Question?', ts: '123.1' },
              { user: 'U2', text: 'Answer', ts: '123.2' },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackReadThreadTool;
    const result = await tool.execute(
      { channel: '#general', threadTs: '1234567890.000001' },
      context(),
    );
    expect(result).toContain('Question?');
    expect(result).toContain('↳');
    expect(result).toContain('Answer');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/conversations.replies');
    expect(String(init?.body ?? '')).toContain('ts=1234567890.000001');
  });

  it('slack_get_status shows the authenticated user status', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('auth.test')) {
        return new Response(JSON.stringify({ ok: true, user_id: 'U1' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          user: {
            name: 'jane',
            profile: {
              display_name: 'Jane',
              real_name: 'Jane Doe',
              email: 'jane@example.com',
              status_text: 'In a meeting',
              status_emoji: ':calendar:',
              status_expiration: Math.floor(Date.now() / 1000) + 3600,
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackGetStatusTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('jane');
    expect(result).toContain(':calendar: In a meeting');
    expect(result).toContain('jane@example.com');
    expect(result).toContain('Status expires');
    const [input, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(input)).toBe('https://slack.com/api/users.info');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer slack_token');
  });

  it('slack_set_status sets a status with emoji and expiry', async () => {
    seedIntegration(USER_ID, 'slack', 'slack_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ ok: true, profile: { status_text: 'Lunch' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = slackSetStatusTool;
    const result = await tool.execute(
      { text: 'Lunch', emoji: ':pizza:', expiresInMinutes: '60' },
      context(),
    );
    expect(result).toContain(':pizza: Lunch');
    expect(result).toContain('expires in 60 minutes');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://slack.com/api/users.profile.set');
    const body = String(init?.body ?? '');
    expect(body).toContain('status_emoji');
    expect(body).toContain('status_expiration');
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

  it('notion_workspace shows the connected workspace', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            object: 'user',
            id: 'bot-1',
            name: 'Agent Integration',
            type: 'bot',
            bot: {
              owner: { type: 'workspace', workspace: true },
              workspace_id: 'ws-42',
              workspace_name: 'Acme Workspace',
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionWorkspaceTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Acme Workspace');
    expect(result).toContain('ws-42');
    expect(result).toContain('Agent Integration');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/users/me');
    expect(init?.method).toBe('GET');
  });

  it('notion_search_databases lists matching databases with properties', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                object: 'database',
                id: 'db-1',
                title: [{ plain_text: 'Project Tracker' }],
                properties: {
                  Name: { id: 'title', type: 'title' },
                  Status: { id: 'status', type: 'select' },
                  Assignee: { id: 'assignee', type: 'people' },
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionSearchDatabasesTool;
    const result = await tool.execute({ query: 'tracker' }, context());
    expect(result).toContain('Project Tracker');
    expect(result).toContain('db-1');
    expect(result).toContain('Status (select)');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/search');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.filter).toEqual({ value: 'database', property: 'object' });
  });

  it('notion_create_page creates a page under a parent', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            id: 'new-page',
            properties: { title: { type: 'title', title: [{ plain_text: 'Fresh' }] } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionCreatePageTool;
    const result = await tool.execute({ parentId: 'parent-1', title: 'Fresh' }, context());
    expect(result).toContain('Fresh');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/pages');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.parent).toEqual({ type: 'page_id', page_id: 'parent-1' });
  });

  it('notion_update_page patches the page title', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            id: 'page-9',
            properties: { title: { type: 'title', title: [{ plain_text: 'Renamed' }] } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionUpdatePageTool;
    const result = await tool.execute({ pageId: 'page-9', title: 'Renamed' }, context());
    expect(result).toContain('Renamed');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/pages/page-9');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.properties.title.title[0].text.content).toBe('Renamed');
    expect(body.archived).toBeUndefined();
  });

  it('notion_update_page archives a page when archived is true', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            id: 'page-9',
            archived: true,
            properties: {},
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = notionUpdatePageTool;
    const result = await tool.execute({ pageId: 'page-9', archived: 'true' }, context());
    expect(result).toContain('page-9');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://api.notion.com/v1/pages/page-9');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.archived).toBe(true);
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

  it('gmail_read returns headers and decoded body of a message', async () => {
    seedIntegration(USER_ID, 'google-gmail', 'gmail_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Hello there' },
                { name: 'Date', value: 'Tue, 5 Aug 2026 09:00:00 +0000' },
              ],
              body: { data: Buffer.from('Hello body', 'utf8').toString('base64url') },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = gmailReadTool;
    const result = await tool.execute({ messageId: 'msg-123' }, context());
    expect(result).toContain('From: sender@example.com');
    expect(result).toContain('Subject: Hello there');
    expect(result).toContain('Hello body');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('messages/msg-123');
    expect(String(input)).toContain('format=full');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer gmail_token');
  });

  it('drive_read_file reads and returns a native Google file as text', async () => {
    seedIntegration(USER_ID, 'google-drive', 'drive_token');
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/export')) {
        return new Response('Meeting notes here', { status: 200 });
      }
      return new Response(
        JSON.stringify({ name: 'notes', mimeType: 'application/vnd.google-apps.document' }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = driveReadFileTool;
    const result = await tool.execute({ fileId: 'file-1' }, context());
    expect(result).toContain('notes');
    expect(result).toContain('Meeting notes here');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('files/file-1');
    expect(String(input)).toContain('fields=name,mimeType');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer drive_token');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/files/file-1/export');
  });

  it('drive_upload_file uploads a multipart file to Drive', async () => {
    seedIntegration(USER_ID, 'google-drive', 'drive_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ id: 'new-1', name: 'report.txt' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = driveUploadFileTool;
    const result = await tool.execute(
      { name: 'report.txt', content: 'Quarterly numbers' },
      context(),
    );
    expect(result).toContain('report.txt');
    expect(result).toContain('new-1');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('upload/drive/v3/files?uploadType=multipart');
    expect(init?.method).toBe('POST');
    const body = String(init?.body ?? '');
    expect(body).toContain('Quarterly numbers');
    expect(body).toContain('report.txt');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer drive_token');
    expect(headers['content-type']).toContain('multipart/related; boundary=');
  });

  it('docs_search lists Google Documents from Drive', async () => {
    seedIntegration(USER_ID, 'google-docs', 'docs_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            files: [
              { id: 'doc-1', name: 'Quarterly Report', modifiedTime: '2026-08-02T10:00:00.000Z' },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = docsSearchTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Quarterly Report');
    expect(result).toContain('doc-1');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('drive/v3/files');
    expect(String(input)).toContain('application%2Fvnd.google-apps.document');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer docs_token');
  });

  it('docs_read returns the plain text of a document', async () => {
    seedIntegration(USER_ID, 'google-docs', 'docs_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            title: 'Quarterly Report',
            body: {
              content: [
                { textRun: { content: 'Revenue grew ' } },
                { textRun: { content: '20% this quarter.' } },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = docsReadTool;
    const result = await tool.execute({ documentId: 'doc-1' }, context());
    expect(result).toContain('Quarterly Report');
    expect(result).toContain('Revenue grew 20% this quarter.');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('docs.googleapis.com/v1/documents/doc-1');
    const headers = init?.headers ?? {};
    expect(headers.authorization).toBe('Bearer docs_token');
  });

  it('sheets_list lists Google Sheets from Drive', async () => {
    seedIntegration(USER_ID, 'google-sheets', 'sheets_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            files: [{ id: 'sheet-1', name: 'Budget', modifiedTime: '2026-08-01T10:00:00.000Z' }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = sheetsListTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Budget');
    expect(result).toContain('sheet-1');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('application%2Fvnd.google-apps.spreadsheet');
  });

  it('sheets_read returns cell values from the Sheets API', async () => {
    seedIntegration(USER_ID, 'google-sheets', 'sheets_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            values: [
              ['Item', 'Amount'],
              ['Revenue', '1000'],
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = sheetsReadTool;
    const result = await tool.execute({ spreadsheetId: 'sheet-1' }, context());
    expect(result).toContain('Revenue');
    expect(result).toContain('1000');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('sheets.googleapis.com/v4/spreadsheets/sheet-1/values/');
  });

  it('tasks_list lists the user task lists', async () => {
    seedIntegration(USER_ID, 'google-tasks', 'tasks_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ items: [{ id: 'list-1', title: 'Work' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = tasksListTool;
    const result = await tool.execute({}, context());
    expect(result).toContain('Work');
    expect(result).toContain('list-1');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('tasks.googleapis.com/tasks/v1/users/@me/lists');
  });

  it('tasks_list lists tasks within a list', async () => {
    seedIntegration(USER_ID, 'google-tasks', 'tasks_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            items: [{ id: 't-1', title: 'Ship report', due: '2026-08-10T00:00:00.000Z' }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = tasksListTool;
    const result = await tool.execute({ listId: 'list-1' }, context());
    expect(result).toContain('Ship report');
    expect(result).toContain('due 2026-08-10');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('/lists/list-1/tasks');
  });

  it('tasks_create creates a task in a list', async () => {
    seedIntegration(USER_ID, 'google-tasks', 'tasks_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(JSON.stringify({ id: 't-2', title: 'Ship report' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = tasksCreateTool;
    const result = await tool.execute({ title: 'Ship report', listId: 'list-1' }, context());
    expect(result).toContain('Ship report');
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body.title).toBe('Ship report');
  });

  it('contacts_search finds matching contacts', async () => {
    seedIntegration(USER_ID, 'google-contacts', 'contacts_token');
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                person: {
                  names: [{ displayName: 'Jane Doe' }],
                  emailAddresses: [{ value: 'jane@example.com' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = contactsSearchTool;
    const result = await tool.execute({ query: 'jane' }, context());
    expect(result).toContain('Jane Doe');
    expect(result).toContain('jane@example.com');
    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toContain('people.googleapis.com/v1/people:searchContacts');
    expect(String(input)).toContain('query=jane');
  });

  it('blocks github_list_repos when the repos permission is disabled', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token', null, null, ['github.profile']);
    await expect(githubListReposTool.execute({}, context())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('blocks tools with a Permission Center message when nothing is enabled', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token', null, null, []);
    await expect(githubListReposTool.execute({}, context())).rejects.toThrow(/Permission Center/);
  });

  it('allows github_list_repos when the repos permission is enabled', async () => {
    seedIntegration(USER_ID, 'github', 'gh_token', null, null, ['github.repos']);
    const fetchMock = vi.fn(
      async (_input: string, _init?: MockFetchInit) =>
        new Response(
          JSON.stringify([{ full_name: 'octocat/Hello-World', default_branch: 'main' }]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubListReposTool.execute({}, context());
    expect(result).toContain('octocat/Hello-World');
  });

  it('blocks notion_create_page when the write permission is disabled', async () => {
    seedIntegration(USER_ID, 'notion', 'notion_token', null, null, []);
    await expect(
      notionCreatePageTool.execute({ parentId: 'db1', title: 'Hello' }, context()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('blocks discord_send_message when the send permission is disabled', async () => {
    seedIntegration(USER_ID, 'discord', 'https://discord.com/api/webhooks/abc/def', null, null, []);
    await expect(
      discordSendMessageTool.execute({ content: 'hi' }, context()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
