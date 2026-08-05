import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/index.js';
import { fetchWithTimeout } from '../lib/http.js';
import { getProvider } from './providers.js';
import type { OAuthProviderDef } from './types.js';

const ALGORITHM = 'HS256';
const encoder = new TextEncoder();
const STATE_TTL_SECONDS = 10 * 60;
/** Access tokens within this many ms of expiry are treated as expired and refreshed. */
export const REFRESH_WINDOW_MS = 60_000;

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function secureEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export type OAuthStatePayload = {
  sub: string;
  provider: string;
  accountKey?: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  requestedScopes?: string[];
  exp: number;
};

export async function signOAuthState(payload: Omit<OAuthStatePayload, 'exp'>): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + STATE_TTL_SECONDS)
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyOAuthState(token: string): Promise<OAuthStatePayload> {
  const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret), {
    algorithms: [ALGORITHM],
  });
  return {
    sub: String(payload.sub ?? ''),
    provider: String(payload.provider ?? ''),
    accountKey: typeof payload.accountKey === 'string' ? payload.accountKey : undefined,
    codeVerifier: String(payload.codeVerifier ?? ''),
    codeChallenge: String(payload.codeChallenge ?? ''),
    redirectUri: String(payload.redirectUri ?? ''),
    requestedScopes: Array.isArray(payload.requestedScopes)
      ? (payload.requestedScopes as unknown[]).filter(
          (scope): scope is string => typeof scope === 'string',
        )
      : undefined,
    exp: payload.exp ?? 0,
  };
}

export type AuthorizationUrlOptions = {
  userId: string;
  providerId: string;
  accountKey?: string;
  scopes?: string[];
  redirectUri?: string;
};

export type AuthorizationUrlResult = {
  url: string;
  state: string;
  verifier: string;
  challenge: string;
};

export async function createAuthorizationUrl(
  options: AuthorizationUrlOptions,
): Promise<AuthorizationUrlResult> {
  const provider = getProvider(options.providerId);
  if (!provider || provider.type !== 'oauth') {
    throw new Error(`Provider "${options.providerId}" is not an OAuth provider`);
  }
  if (!provider.oauthConfigured) {
    throw new Error(`OAuth is not configured for ${provider.label}`);
  }
  const pkce = generatePkcePair();
  const redirectUri =
    options.redirectUri ?? `${config.integrationRedirectBase}/${options.providerId}/callback`;
  const state = await signOAuthState({
    sub: options.userId,
    provider: options.providerId,
    accountKey: options.accountKey,
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
    redirectUri,
    requestedScopes: options.scopes,
  });
  const params = provider.authorizationParams(state, redirectUri, {
    codeChallenge: provider.pkce === false ? undefined : pkce.challenge,
    scopes: options.scopes,
  });
  return {
    url: `${provider.authorizationUrl}?${params.toString()}`,
    state,
    verifier: pkce.verifier,
    challenge: pkce.challenge,
  };
}

export type TokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
};

async function postTokenForm(
  label: string,
  tokenUrl: string,
  params: URLSearchParams,
  action: string,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    timeoutMs: 10_000,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: params.toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `status ${response.status}`;
    throw new Error(`${label} token ${action} failed: ${detail}`);
  }
  return body;
}

async function tokenResult(
  provider: OAuthProviderDef,
  body: Record<string, unknown>,
  action: string,
  refreshTokenFallback: string | null,
): Promise<TokenExchangeResult> {
  const accessToken = provider.tokenResponseAccessToken(body);
  if (!accessToken) {
    throw new Error(`${provider.label} token ${action} returned no access token`);
  }
  return {
    accessToken,
    refreshToken: provider.tokenResponseRefreshToken(body) ?? refreshTokenFallback,
    expiresIn: provider.tokenResponseExpiresIn(body),
    scope: provider.tokenResponseScope(body),
  };
}

export type CodeExchangeOptions = {
  codeVerifier?: string;
  redirectUri: string;
};

export async function exchangeCodeForToken(
  providerId: string,
  code: string,
  options: CodeExchangeOptions,
): Promise<TokenExchangeResult> {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth') {
    throw new Error(`Provider "${providerId}" is not an OAuth provider`);
  }
  const params = provider.tokenParams(code, options.redirectUri, {
    codeVerifier: provider.pkce === false ? undefined : options.codeVerifier,
  });
  const body = await postTokenForm(provider.label, provider.tokenUrl, params, 'exchange');
  return tokenResult(provider, body, 'exchange', null);
}

export async function refreshAccessToken(
  providerId: string,
  refreshToken: string,
): Promise<TokenExchangeResult> {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth' || !provider.supportsRefresh) {
    throw new Error(`Refresh is not supported for provider "${providerId}"`);
  }
  const params = provider.refreshParams(refreshToken);
  const body = await postTokenForm(provider.label, provider.tokenUrl, params, 'refresh');
  return tokenResult(provider, body, 'refresh', refreshToken);
}

export async function fetchProviderAccountName(
  providerId: string,
  accessToken: string,
): Promise<string | null> {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth') {
    return null;
  }
  try {
    return await provider.accountName(accessToken);
  } catch {
    return null;
  }
}

const refreshFlights = new Map<string, Promise<unknown>>();

/**
 * Coalesces concurrent refreshes for the same key into a single in-flight
 * operation so a burst of tool calls cannot stampede the provider token
 * endpoint and rotate the refresh token more than once.
 */
export async function withRefreshFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = refreshFlights.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const flight = task().finally(() => {
    refreshFlights.delete(key);
  });
  refreshFlights.set(key, flight);
  return flight;
}

export function clearRefreshFlights(): void {
  refreshFlights.clear();
}
