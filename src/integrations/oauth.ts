import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/index.js';
import { getProvider } from './providers.js';

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

export async function exchangeProviderCode(
  providerId: string,
  code: string,
): Promise<ProviderTokenResult> {
  const provider = getProvider(providerId);
  if (!provider || provider.type !== 'oauth') {
    throw new Error(`Provider "${providerId}" is not an OAuth provider`);
  }
  const params = provider.tokenParams(code, '');
  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
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
    throw new Error(`${provider.label} token exchange failed: ${detail}`);
  }
  const accessToken = provider.tokenResponseAccessToken(body);
  if (!accessToken) {
    throw new Error(`${provider.label} token exchange returned no access token`);
  }
  return {
    accessToken,
    refreshToken: provider.tokenResponseRefreshToken(body),
    expiresIn: provider.tokenResponseExpiresIn(body),
    scope: provider.tokenResponseScope(body),
  };
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
  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
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
    throw new Error(`${provider.label} token refresh failed: ${detail}`);
  }
  const accessToken = provider.tokenResponseAccessToken(body);
  if (!accessToken) {
    throw new Error(`${provider.label} token refresh returned no access token`);
  }
  return {
    accessToken,
    refreshToken: provider.tokenResponseRefreshToken(body) ?? refreshToken,
    expiresIn: provider.tokenResponseExpiresIn(body),
    scope: provider.tokenResponseScope(body),
  };
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
