vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccount,
  disconnectIntegration,
  fetchHub,
  reconnectIntegration,
  refreshIntegration,
  syncHistory,
  testIntegration,
} from '@/lib/integrations';
import { clearTokens, setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('integration hub api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access', 'stored-refresh');
  });

  it('fetches the hub providers with health and last sync', async () => {
    const providers = [
      {
        id: 'github',
        label: 'GitHub',
        description: 'Code',
        type: 'oauth',
        icon: 'github',
        configured: true,
        connected: true,
        accountName: 'octocat',
        accountKey: 'default',
        status: 'connected',
        scopes: 'repo read:user',
        connectedAt: '2026-08-01T10:00:00.000Z',
        tokenExpiresAt: null,
        revokedAt: null,
        revokedReason: null,
        capabilities: ['github:repos'],
        permissions: [
          {
            id: 'github.repos',
            label: 'Repositories',
            description: 'Read repos',
            scope: 'repo',
            capability: 'github:repos',
            enabled: true,
          },
        ],
        lastRefreshedAt: null,
        refreshCount: 0,
        health: {
          status: 'connected',
          ok: true,
          latencyMs: 42,
          lastMessage: 'Connected',
          lastHealthCheckAt: '2026-08-05T10:00:00.000Z',
          lastSuccessAt: '2026-08-05T10:00:00.000Z',
        },
        lastSync: {
          id: 's1',
          kind: 'health',
          status: 'SUCCESS',
          startedAt: '2026-08-05T10:00:00.000Z',
          finishedAt: '2026-08-05T10:00:01.000Z',
          itemCount: 0,
          error: null,
        },
        accountCount: 1,
      },
    ];
    fetchMock.mockResolvedValue(jsonResponse({ providers }));

    const result = await fetchHub();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/hub');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access' });
    expect(result).toHaveLength(1);
    expect(result[0].health?.ok).toBe(true);
    expect(result[0].health?.latencyMs).toBe(42);
    expect(result[0].lastSync?.status).toBe('SUCCESS');
    expect(result[0].accountCount).toBe(1);
  });

  it('posts to the connection test endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, accountName: 'octocat', message: 'Connected', latencyMs: 30 }),
    );

    const result = await testIntegration('github');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/github/test');
    expect(init.method).toBe('POST');
    expect(result.latencyMs).toBe(30);
  });

  it('deletes an integration via DELETE', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await disconnectIntegration('github');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/github');
    expect(init.method).toBe('DELETE');
  });

  it('deletes a single account via DELETE', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteAccount('github', 'account-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/github/accounts/account-1');
    expect(init.method).toBe('DELETE');
  });

  it('requests a reconnect URL with an account key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        accountKey: 'work',
        url: 'https://github.com/login/oauth/authorize?...',
      }),
    );

    const result = await reconnectIntegration('github', 'work', 'repo');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ accountKey: 'work', scopes: 'repo' });
    expect(result.url).toContain('github.com');
  });

  it('refreshes OAuth tokens', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: 'connected',
        tokenExpiresAt: 'x',
        lastRefreshedAt: 'y',
        refreshCount: 2,
      }),
    );

    const result = await refreshIntegration('github');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/github/refresh');
    expect(init.method).toBe('POST');
    expect(result.refreshCount).toBe(2);
  });

  it('fetches sync history with a limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ history: [{ id: 's1', status: 'SUCCESS' }] }));

    const result = await syncHistory('github', 8);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://test.local/api/v1/integrations/github/sync-history?limit=8');
    expect(result).toHaveLength(1);
  });

  it('throws when not authenticated', async () => {
    clearTokens();

    await expect(fetchHub()).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
