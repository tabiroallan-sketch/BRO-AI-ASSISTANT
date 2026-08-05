import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

const SLACK_SCOPES = [
  'channels:read',
  'channels:history',
  'chat:write',
  'users:read',
  'users:read.email',
];

function slackAccountName(accessToken: string): Promise<string | null> {
  return fetchWithTimeout('https://slack.com/api/auth.test', {
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${accessToken}` },
  }).then(async (response) => {
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { ok?: boolean; user?: string; team?: string };
    if (!body.ok) {
      return null;
    }
    return [body.user, body.team].filter(Boolean).join(' · ') || 'Slack';
  });
}

export const slackProvider: OAuthProviderDef = {
  id: 'slack',
  label: 'Slack',
  description: 'Channels, messages, users, threads, and status.',
  type: 'oauth',
  icon: 'slack',
  oauthConfigured: Boolean(config.slackClientId && config.slackClientSecret),
  scopes: SLACK_SCOPES,
  capabilities: [
    'slack:send',
    'slack:channels',
    'slack:messages',
    'slack:users',
    'slack:threads',
    'slack:status',
  ],
  permissions: [
    {
      id: 'slack.send',
      label: 'Send Messages',
      description: 'Post messages to Slack channels and reply in threads.',
      scope: 'chat:write',
      capability: 'slack:send',
    },
    {
      id: 'slack.channels',
      label: 'Channels',
      description: 'List the public channels in your workspace.',
      scope: 'channels:read',
      capability: 'slack:channels',
    },
    {
      id: 'slack.messages',
      label: 'Messages',
      description: 'Read recent messages in your channels.',
      scope: 'channels:history',
      capability: 'slack:messages',
    },
    {
      id: 'slack.users',
      label: 'Users',
      description: 'List members of your workspace.',
      scope: 'users:read users:read.email',
      capability: 'slack:users',
    },
    {
      id: 'slack.threads',
      label: 'Threads',
      description: 'Read thread replies and reply in threads.',
      scope: 'channels:history chat:write',
      capability: 'slack:threads',
    },
    {
      id: 'slack.status',
      label: 'Status',
      description: 'Read and set your Slack status.',
      scope: 'users:read',
      capability: 'slack:status',
    },
  ],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    const scopes = opts?.scopes ?? SLACK_SCOPES;
    const params = new URLSearchParams({
      client_id: config.slackClientId,
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
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
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
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
      grant_type: 'refresh_token',
    });
  },
  accountName: slackAccountName,
  async healthCheck(token) {
    const account = await slackAccountName(token);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach Slack' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 0),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
