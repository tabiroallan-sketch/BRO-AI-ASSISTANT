import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

function githubAccountName(accessToken: string): Promise<string | null> {
  return fetchWithTimeout('https://api.github.com/user', {
    timeoutMs: 10_000,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'bro-assistant',
    },
  }).then(async (response) => {
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { login?: string };
    return body.login ?? null;
  });
}

export const githubProvider: OAuthProviderDef = {
  id: 'github',
  label: 'GitHub',
  description: 'Repositories, issues, pull requests, actions, commits, and releases.',
  type: 'oauth',
  icon: 'github',
  oauthConfigured: Boolean(config.githubClientId && config.githubClientSecret),
  scopes: ['repo', 'read:user'],
  capabilities: [
    'github:repos',
    'github:issues',
    'github:pulls',
    'github:actions',
    'github:commits',
    'github:releases',
  ],
  permissions: [
    {
      id: 'github.repos',
      label: 'Repositories',
      description: 'List and read your repositories.',
      scope: 'repo',
      capability: 'github:repos',
    },
    {
      id: 'github.issues',
      label: 'Issues',
      description: 'List and create issues on your repositories.',
      scope: 'repo',
      capability: 'github:issues',
    },
    {
      id: 'github.pulls',
      label: 'Pull Requests',
      description: 'List pull requests on your repositories.',
      scope: 'repo',
      capability: 'github:pulls',
    },
    {
      id: 'github.actions',
      label: 'Actions',
      description: 'List workflow runs on your repositories.',
      scope: 'repo',
      capability: 'github:actions',
    },
    {
      id: 'github.commits',
      label: 'Commits',
      description: 'List commits on your repositories.',
      scope: 'repo',
      capability: 'github:commits',
    },
    {
      id: 'github.releases',
      label: 'Releases',
      description: 'List releases on your repositories.',
      scope: 'repo',
      capability: 'github:releases',
    },
    {
      id: 'github.profile',
      label: 'Profile',
      description: 'Read your public profile and repository count.',
      scope: 'read:user',
      capability: 'github:repos',
    },
  ],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    const scopes = opts?.scopes ?? ['repo', 'read:user'];
    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      allow_signup: 'true',
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
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
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
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      grant_type: 'refresh_token',
    });
  },
  accountName: githubAccountName,
  async healthCheck(token) {
    const login = await githubAccountName(token);
    return {
      ok: login !== null,
      accountName: login,
      message: login === null ? 'Could not reach GitHub' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 0),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
