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
import { getAuditLogs, listUsers, updateUser } from '@/lib/dashboard';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('admin client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists users with the bearer token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        count: 1,
        users: [
          {
            id: 'user-1',
            email: 'admin@example.com',
            displayName: 'Admin',
            role: 'ADMIN',
            isActive: true,
            createdAt: '2026-08-03T00:00:00Z',
          },
        ],
      }),
    );

    const users = await listUsers();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/admin/users',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    );
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe('ADMIN');
  });

  it('updates a user role with a PATCH request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user: {
          id: 'user-1',
          email: 'user@example.com',
          displayName: null,
          role: 'ADMIN',
          isActive: true,
        },
      }),
    );

    const updated = await updateUser('user-1', { role: 'ADMIN' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/admin/users/user-1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ role: 'ADMIN' }));
    expect(updated.role).toBe('ADMIN');
  });

  it('fetches the audit log with a limit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        count: 1,
        events: [
          {
            id: 'event-1',
            at: '2026-08-03T00:00:00Z',
            actorEmail: 'admin@example.com',
            action: 'admin.user.update',
            detail: '{"role":"ADMIN"}',
          },
        ],
      }),
    );

    const events = await getAuditLogs(50);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/admin/audit?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('admin.user.update');
  });
});
