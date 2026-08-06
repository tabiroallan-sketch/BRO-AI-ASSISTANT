import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

const CLICKUP_SCOPES = [
  'task:read',
  'task:write',
  'space:read',
  'space:write',
  'folder:read',
  'list:read',
  'team:read',
  'user:read',
];

async function clickupAccountName(accessToken: string): Promise<string | null> {
  const response = await fetchWithTimeout('https://api.clickup.com/api/v2/user', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    user?: { username?: string; email?: string };
  };
  return [body.user?.username, body.user?.email].filter(Boolean).join(' · ') || 'ClickUp';
}

export const clickupProvider: OAuthProviderDef = {
  id: 'clickup',
  label: 'ClickUp',
  description: 'Tasks, spaces, folders, lists, and teams.',
  type: 'oauth',
  icon: 'clickup',
  oauthConfigured: Boolean(config.clickupClientId && config.clickupClientSecret),
  scopes: CLICKUP_SCOPES,
  capabilities: ['clickup:tasks', 'clickup:spaces', 'clickup:teams'],
  permissions: [
    {
      id: 'clickup.tasks.read',
      label: 'Read Tasks',
      description: 'List and read tasks across your ClickUp workspaces.',
      scope: 'task:read',
      capability: 'clickup:tasks',
    },
    {
      id: 'clickup.tasks.write',
      label: 'Create Tasks',
      description: 'Create and update tasks in ClickUp.',
      scope: 'task:write',
      capability: 'clickup:tasks',
    },
    {
      id: 'clickup.spaces',
      label: 'Spaces & Lists',
      description: 'List your ClickUp teams, spaces, folders, and lists.',
      scope: 'space:read team:read folder:read list:read',
      capability: 'clickup:spaces',
    },
    {
      id: 'clickup.teams',
      label: 'Teams & Users',
      description: 'Read your ClickUp workspace members.',
      scope: 'team:read user:read',
      capability: 'clickup:teams',
    },
  ],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://app.clickup.com/api/oauth/authorize',
  tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    const params = new URLSearchParams({
      client_id: config.clickupClientId,
      redirect_uri: redirectUri,
      state,
    });
    const scopes = opts?.scopes ?? CLICKUP_SCOPES;
    params.set('scope', scopes.join(' '));
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
      client_id: config.clickupClientId,
      client_secret: config.clickupClientSecret,
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
      client_id: config.clickupClientId,
      client_secret: config.clickupClientSecret,
    });
  },
  accountName: clickupAccountName,
  async healthCheck(token) {
    const account = await clickupAccountName(token);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach ClickUp' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 3600),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
