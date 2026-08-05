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
import { listPermissions, updatePermissions } from '@/lib/integrations';
import { clearTokens, setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('permission center api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access', 'stored-refresh');
  });

  it('lists providers with granted and enabled permission states', async () => {
    const providers = [
      {
        id: 'google-gmail',
        label: 'Gmail',
        description: 'Email',
        icon: 'google',
        type: 'oauth',
        configured: true,
        connected: true,
        accountName: 'me@example.com',
        accountKey: null,
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        permissions: [
          {
            id: 'gmail.read',
            label: 'Read Gmail',
            description: 'Read emails',
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            capability: 'gmail:read',
            granted: true,
            enabled: true,
          },
          {
            id: 'gmail.send',
            label: 'Send Gmail',
            description: 'Send emails',
            scope: 'https://www.googleapis.com/auth/gmail.send',
            capability: 'gmail:send',
            granted: false,
            enabled: false,
          },
        ],
      },
    ];
    fetchMock.mockResolvedValue(jsonResponse({ providers }));

    const result = await listPermissions();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/permissions');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access' });
    expect(result).toHaveLength(1);
    expect(result[0].permissions).toHaveLength(2);
    expect(result[0].permissions[0].granted).toBe(true);
    expect(result[0].permissions[0].enabled).toBe(true);
    expect(result[0].permissions[1].enabled).toBe(false);
  });

  it('updates the enabled permission ids via PUT', async () => {
    const provider = {
      id: 'google-gmail',
      label: 'Gmail',
      description: 'Email',
      icon: 'google',
      type: 'oauth',
      configured: true,
      connected: true,
      accountName: 'me@example.com',
      accountKey: null,
      scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      permissions: [
        {
          id: 'gmail.read',
          label: 'Read Gmail',
          description: 'Read emails',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          capability: 'gmail:read',
          granted: true,
          enabled: false,
        },
      ],
    };
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, provider: 'google-gmail', permissions: provider }),
    );

    const result = await updatePermissions('google-gmail', []);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/integrations/google-gmail/permissions');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ permissions: [] });
    expect(result.id).toBe('google-gmail');
    expect(result.permissions[0].enabled).toBe(false);
  });

  it('throws when not authenticated', async () => {
    clearTokens();

    await expect(listPermissions()).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
