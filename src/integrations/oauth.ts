import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/index.js';
import { getProvider, type OAuthProviderDef } from './providers.js';
import { fetchWithTimeout } from '../lib/http.js';

const ALGORITHM = 'HS256';
const encoder = new TextEncoder();

export type IntegrationStatePayload = {
  sub: string;
  provider: string;
  exp: number;
};

export async function signIntegrationState(userId: string, providerId: string): Promise<string> {
  return new SignJWT({ provider: providerId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyIntegrationState(token: string): Promise<IntegrationStatePayload> {
  const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret), {
    algorithms: [ALGORITHM],
  });
  return {
    sub: String(payload.sub ?? ''),
    provider: String(payload.provider ?? ''),
    exp: payload.exp ?? 0,
  };
}

export function buildProviderAuthorizationUrl(providerId: string, state: string): string {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth') {
    throw new Error(`Provider "${providerId}" is not an OAuth provider`);
  }
  if (!provider.oauthConfigured) {
    throw new Error(`OAuth is not configured for ${provider.label}`);
  }
  const params = provider.authorizationParams(state, '');
  return `${provider.authorizationUrl}?${params.toString()}`;
}

export type ProviderTokenResult = {
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
): Promise<ProviderTokenResult> {
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

export async function exchangeProviderCode(
  providerId: string,
  code: string,
): Promise<ProviderTokenResult> {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth') {
    throw new Error(`Provider "${providerId}" is not an OAuth provider`);
  }
  const params = provider.tokenParams(code, '');
  const body = await postTokenForm(provider.label, provider.tokenUrl, params, 'exchange');
  return tokenResult(provider, body, 'exchange', null);
}

export async function refreshProviderToken(
  providerId: string,
  refreshToken: string,
): Promise<ProviderTokenResult> {
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
