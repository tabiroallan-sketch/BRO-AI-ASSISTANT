import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearProviders, registerProvider } from '../../src/integrations/registry.js';
import type { OAuthProviderDef } from '../../src/integrations/types.js';
import {
  clearRefreshFlights,
  createAuthorizationUrl,
  exchangeCodeForToken,
  generatePkcePair,
  hashToken,
  refreshAccessToken,
  secureEqual,
  signOAuthState,
  verifyOAuthState,
  withRefreshFlight,
} from '../../src/integrations/oauth-engine.js';

const provider: OAuthProviderDef = {
  id: 'engine-test',
  label: 'Engine Test',
  description: 'Test OAuth engine',
  type: 'oauth',
  icon: 'external',
  oauthConfigured: true,
  scopes: ['read', 'write'],
  capabilities: ['engine:read'],
  permissions: [],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://provider.example/auth',
  tokenUrl: 'https://provider.example/token',
  authorizationParams(state, redirectUri, opts): URLSearchParams {
    const scopes = opts?.scopes ?? ['read', 'write'];
    const params = new URLSearchParams({
      state,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
    });
    if (opts?.codeChallenge) {
      params.set('code_challenge', opts.codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return params;
  },
  tokenParams(code, redirectUri, opts): URLSearchParams {
    const params = new URLSearchParams({ code, redirect_uri: redirectUri });
    if (opts?.codeVerifier) {
      params.set('code_verifier', opts.codeVerifier);
    }
    return params;
  },
  refreshParams(refreshToken): URLSearchParams {
    return new URLSearchParams({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  },
  accountName: async () => 'tester',
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 0),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};

const noPkceProvider: OAuthProviderDef = {
  ...provider,
  id: 'engine-nopkce',
  pkce: false,
};

const noRefreshProvider: OAuthProviderDef = {
  ...provider,
  id: 'engine-norefresh',
  supportsRefresh: false,
};

function stubTokenResponse(body: Record<string, unknown>, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  clearProviders();
  clearRefreshFlights();
  registerProvider(provider);
  registerProvider(noPkceProvider);
  registerProvider(noRefreshProvider);
  vi.unstubAllGlobals();
});

describe('PKCE and token hashing', () => {
  it('generates a verifier and S256 challenge derived from it', () => {
    const pair = generatePkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
    const again = generatePkcePair();
    expect(again.verifier).not.toBe(pair.verifier);
  });

  it('hashes tokens deterministically and compares them in constant time', () => {
    expect(hashToken('secret')).toBe(hashToken('secret'));
    expect(hashToken('secret')).not.toBe(hashToken('other'));
    expect(secureEqual('abc', 'abc')).toBe(true);
    expect(secureEqual('abc', 'ab')).toBe(false);
    expect(secureEqual('abc', 'abd')).toBe(false);
  });
});

describe('OAuth state validation', () => {
  it('round-trips the full state payload', async () => {
    const state = await signOAuthState({
      sub: 'user-1',
      provider: 'engine-test',
      accountKey: 'work',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: 'https://app.example/callback',
      requestedScopes: ['read'],
    });
    const payload = await verifyOAuthState(state);
    expect(payload.sub).toBe('user-1');
    expect(payload.provider).toBe('engine-test');
    expect(payload.accountKey).toBe('work');
    expect(payload.codeVerifier).toBe('verifier');
    expect(payload.codeChallenge).toBe('challenge');
    expect(payload.redirectUri).toBe('https://app.example/callback');
    expect(payload.requestedScopes).toEqual(['read']);
    expect(payload.exp).toBeGreaterThan(0);
  });

  it('rejects a tampered state', async () => {
    const state = await signOAuthState({
      sub: 'user-1',
      provider: 'engine-test',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: 'https://app.example/callback',
    });
    const parts = state.split('.');
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      sub: string;
    };
    payload.sub = 'user-2';
    const tampered = [
      parts[0],
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      parts[2],
    ].join('.');
    await expect(verifyOAuthState(tampered)).rejects.toThrow();
  });
});

describe('authorization URL building', () => {
  it('includes PKCE challenge, state, and requested scopes', async () => {
    const { url, verifier, challenge, state } = await createAuthorizationUrl({
      userId: 'user-1',
      providerId: 'engine-test',
      accountKey: 'work',
      scopes: ['read'],
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(parsed.searchParams.get('code_challenge')).toBe(challenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('read');
    expect(verifier).toBeTruthy();

    const payload = await verifyOAuthState(state);
    expect(payload.sub).toBe('user-1');
    expect(payload.accountKey).toBe('work');
    expect(payload.codeVerifier).toBe(verifier);
    expect(payload.codeChallenge).toBe(challenge);
  });

  it('skips PKCE for providers that opt out', async () => {
    const { url } = await createAuthorizationUrl({
      userId: 'user-1',
      providerId: 'engine-nopkce',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge')).toBeNull();
    expect(parsed.searchParams.get('code_challenge_method')).toBeNull();
  });

  it('throws when OAuth is not configured', async () => {
    clearProviders();
    registerProvider({ ...provider, oauthConfigured: false });
    await expect(
      createAuthorizationUrl({ userId: 'user-1', providerId: 'engine-test' }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe('code exchange', () => {
  it('exchanges a code with the PKCE verifier and the exact redirect URI', async () => {
    const fetchMock = stubTokenResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'read',
    });
    const result = await exchangeCodeForToken('engine-test', 'the-code', {
      codeVerifier: 'the-verifier',
      redirectUri: 'https://app.example/callback',
    });
    expect(result.accessToken).toBe('access-1');
    expect(result.refreshToken).toBe('refresh-1');
    expect(result.expiresIn).toBe(3600);
    expect(result.scope).toBe('read');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(String(init.body));
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('redirect_uri')).toBe('https://app.example/callback');
  });

  it('does not send a code_verifier for non-PKCE providers', async () => {
    const fetchMock = stubTokenResponse({ access_token: 'access-1' });
    await exchangeCodeForToken('engine-nopkce', 'the-code', {
      codeVerifier: 'the-verifier',
      redirectUri: 'https://app.example/callback',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(String(init.body));
    expect(body.get('code_verifier')).toBeNull();
  });

  it('surfaces a token endpoint error', async () => {
    stubTokenResponse({ error: 'invalid_grant', error_description: 'bad code' }, 400);
    await expect(
      exchangeCodeForToken('engine-test', 'bad-code', {
        codeVerifier: 'verifier',
        redirectUri: 'https://app.example/callback',
      }),
    ).rejects.toThrow(/bad code/);
  });
});

describe('refresh with rotation', () => {
  it('returns a rotated access token and new refresh token', async () => {
    stubTokenResponse({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 3600,
    });
    const result = await refreshAccessToken('engine-test', 'refresh-1');
    expect(result.accessToken).toBe('access-2');
    expect(result.refreshToken).toBe('refresh-2');
  });

  it('falls back to the presented refresh token when the provider does not rotate', async () => {
    stubTokenResponse({ access_token: 'access-2', expires_in: 3600 });
    const result = await refreshAccessToken('engine-test', 'refresh-1');
    expect(result.accessToken).toBe('access-2');
    expect(result.refreshToken).toBe('refresh-1');
  });

  it('rejects providers that do not support refresh', async () => {
    await expect(refreshAccessToken('engine-norefresh', 'refresh-1')).rejects.toThrow(
      /Refresh is not supported/,
    );
  });
});

describe('refresh flight coalescing', () => {
  it('runs a single task for concurrent refreshes', async () => {
    let runs = 0;
    const task = async (): Promise<string> => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'ok';
    };
    const results = await Promise.all([
      withRefreshFlight('key', task),
      withRefreshFlight('key', task),
      withRefreshFlight('key', task),
    ]);
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(runs).toBe(1);
  });
});
