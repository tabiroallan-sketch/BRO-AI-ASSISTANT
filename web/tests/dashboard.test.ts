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
import { clearLogs, getAnalytics, getAutomations, getLogs, listTools } from '@/lib/dashboard';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('dashboard client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists tools with the bearer token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        count: 2,
        tools: [
          { name: 'get_weather', description: 'Current weather' },
          { name: 'echo', description: 'Echoes input' },
        ],
      }),
    );

    const tools = await listTools();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/tools',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    );
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('get_weather');
  });

  it('returns automation status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        enabled: true,
        configured: true,
        workflows: [{ id: 'wf-1', name: 'Digest', active: true }],
        executions: [],
      }),
    );

    const automations = await getAutomations();

    expect(automations.enabled).toBe(true);
    expect(automations.workflows[0].name).toBe('Digest');
  });

  it('returns analytics', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        totals: {
          conversations: 1,
          memories: 2,
          integrations: 0,
          notifications: 3,
          messages: 4,
        },
        messagesByRole: { user: 2, assistant: 2 },
        daily: [{ date: '2026-08-03', count: 4 }],
      }),
    );

    const analytics = await getAnalytics();

    expect(analytics.totals.messages).toBe(4);
    expect(analytics.daily).toHaveLength(1);
  });

  it('fetches logs with a limit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ logs: [{ level: 'info', time: '2026-08-03T00:00:00Z', msg: 'ready' }] }),
    );

    const logs = await getLogs(50);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/logs?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('ready');
  });

  it('clears logs with a DELETE request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await clearLogs();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/logs');
    expect(init.method).toBe('DELETE');
  });
});
