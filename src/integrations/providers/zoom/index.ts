import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

const ZOOM_SCOPES = ['meeting:read', 'meeting:write', 'user:read', 'recording:read'];

async function zoomAccountName(accessToken: string): Promise<string | null> {
  const response = await fetchWithTimeout('https://api.zoom.us/v2/users/me', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  return [body.first_name, body.last_name].filter(Boolean).join(' ') || body.email || 'Zoom';
}

export const zoomProvider: OAuthProviderDef = {
  id: 'zoom',
  label: 'Zoom',
  description: 'Meetings, recordings, and user information.',
  type: 'oauth',
  icon: 'zoom',
  oauthConfigured: Boolean(config.zoomClientId && config.zoomClientSecret),
  scopes: ZOOM_SCOPES,
  capabilities: ['zoom:meetings', 'zoom:recordings', 'zoom:users'],
  permissions: [
    {
      id: 'zoom.meetings.read',
      label: 'Read Meetings',
      description: 'List and read your Zoom meetings.',
      scope: 'meeting:read',
      capability: 'zoom:meetings',
    },
    {
      id: 'zoom.meetings.write',
      label: 'Create Meetings',
      description: 'Schedule and update Zoom meetings.',
      scope: 'meeting:write',
      capability: 'zoom:meetings',
    },
    {
      id: 'zoom.recordings',
      label: 'Recordings',
      description: 'List and manage your Zoom cloud recordings.',
      scope: 'recording:read',
      capability: 'zoom:recordings',
    },
    {
      id: 'zoom.users',
      label: 'Users',
      description: 'Read your Zoom profile and user details.',
      scope: 'user:read',
      capability: 'zoom:users',
    },
  ],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://zoom.us/oauth/authorize',
  tokenUrl: 'https://zoom.us/oauth/token',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    const scopes = opts?.scopes ?? ZOOM_SCOPES;
    const params = new URLSearchParams({
      client_id: config.zoomClientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
    });
    if (opts?.codeChallenge) {
      params.set('code_challenge', opts.codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return params;
  },
  tokenParams(
    code: string,
    redirectUri: string,
    opts?: { codeVerifier?: string },
  ): URLSearchParams {
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.zoomClientId,
      client_secret: config.zoomClientSecret,
      redirect_uri: redirectUri,
    });
    if (opts?.codeVerifier) {
      params.set('code_verifier', opts.codeVerifier);
    }
    return params;
  },
  refreshParams(refreshToken: string): URLSearchParams {
    return new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: config.zoomClientId,
      client_secret: config.zoomClientSecret,
    });
  },
  accountName: zoomAccountName,
  async healthCheck(token) {
    const account = await zoomAccountName(token);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach Zoom' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 3600),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
