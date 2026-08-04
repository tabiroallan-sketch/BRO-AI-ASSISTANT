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
  API_BASE_URL,
  ApiError,
  fetchMe,
  fetchProviders,
  GOOGLE_AUTH_URL,
  login,
  logout,
  refresh,
  register,
} from '@/lib/api';
import { clearTokens, setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    clearTokens();
  });

  it('uses the configured API base URL', () => {
    expect(API_BASE_URL).toBe('http://test.local/api/v1');
  });

  it('points the Google auth URL at the backend', () => {
    expect(GOOGLE_AUTH_URL).toBe('http://test.local/api/v1/auth/google');
  });

  it('posts credentials to /auth/login', async () => {
    const payload = {
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '1', email: 'a@b.c', displayName: null, avatarUrl: null, role: 'USER' },
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await login('a@b.c', 'secret');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'secret' });
    expect(result.accessToken).toBe('a');
  });

  it('includes displayName in register when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'a', refreshToken: 'r', user: {} }));
    await register('a@b.c', 'secret', 'Ada');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.c',
      password: 'secret',
      displayName: 'Ada',
    });
  });

  it('omits displayName in register when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'a', refreshToken: 'r', user: {} }));
    await register('a@b.c', 'secret');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'secret' });
  });

  it('rejects refresh when no refresh token is stored', async () => {
    await expect(refresh()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the stored refresh token to /auth/refresh', async () => {
    setTokens('access', 'stored-refresh');
    const payload = { accessToken: 'new-access', refreshToken: 'new-refresh', user: {} };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await refresh();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/auth/refresh');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'stored-refresh' });
    expect(result.accessToken).toBe('new-access');
  });

  it('logs out with the stored refresh token', async () => {
    setTokens('access', 'stored-refresh');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await logout();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'stored-refresh' });
  });

  it('skips the network when logging out without a token', async () => {
    await logout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer token to /auth/me', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user: { id: '1', email: 'a@b.c', displayName: 'Ada', avatarUrl: null, role: 'USER' },
      }),
    );

    await fetchMe('my-token');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/auth/me');
    expect(init.headers).toMatchObject({ authorization: 'Bearer my-token' });
  });

  it('fetches the enabled providers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ providers: [{ id: 'email', label: 'Email' }] }));

    const result = await fetchProviders();

    expect(result.providers).toEqual([{ id: 'email', label: 'Email' }]);
  });

  it('throws an ApiError with the server message on failure', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: { message: 'Invalid credentials' } }, 401)),
    );

    const error = await login('a@b.c', 'wrong').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Invalid credentials' });
  });

  it('throws an ApiError with a generic message when the body is empty', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(fetchMe('token')).rejects.toThrow('Request failed (500)');
  });

  it('refreshes the access token and retries once on a 401', async () => {
    setTokens('stale-access', 'stored-refresh');
    const mePayload = {
      user: { id: '1', email: 'a@b.c', displayName: null, avatarUrl: null, role: 'USER' },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'jwt expired' } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'new-access', refreshToken: 'new-refresh', user: {} }),
      )
      .mockResolvedValueOnce(jsonResponse(mePayload));

    const result = await fetchMe('stale-access');

    expect(result.user.email).toBe('a@b.c');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl] = fetchMock.mock.calls[1] as [string];
    expect(refreshUrl).toContain('/auth/refresh');
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(retryInit.headers).toMatchObject({ authorization: 'Bearer new-access' });
  });

  it('clears tokens and throws when refresh fails after a 401', async () => {
    setTokens('stale-access', 'bad-refresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid refresh token' } }, 401));

    const error = await fetchMe('stale-access').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Session expired' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not attempt a refresh when login returns 401', async () => {
    setTokens('access', 'stored-refresh');
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Invalid credentials' } }, 401));

    const error = await login('a@b.c', 'wrong').catch((err: unknown) => err);

    expect(error).toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent 401 refreshes into a single request', async () => {
    setTokens('stale-access', 'stored-refresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'new-access', refreshToken: 'new-refresh', user: {} }),
      )
      .mockResolvedValueOnce(jsonResponse({ user: { id: '1', email: 'a@b.c' } }))
      .mockResolvedValueOnce(jsonResponse({ providers: [] }));

    await Promise.all([fetchMe('x'), fetchProviders()]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
