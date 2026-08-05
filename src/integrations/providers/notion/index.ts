import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

function notionAccountName(accessToken: string): Promise<string | null> {
  return fetchWithTimeout('https://api.notion.com/v1/users/me', {
    timeoutMs: 10_000,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'notion-version': '2022-06-28',
    },
  }).then(async (response) => {
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      name?: string;
      id?: string;
      bot?: { workspace_name?: string | null };
    };
    return body.bot?.workspace_name ?? body.name ?? body.id ?? null;
  });
}

export const notionProvider: OAuthProviderDef = {
  id: 'notion',
  label: 'Notion',
  description: 'Search and create pages and databases in your workspace.',
  type: 'oauth',
  icon: 'notion',
  oauthConfigured: Boolean(config.notionClientId && config.notionClientSecret),
  scopes: ['data.read', 'data.write', 'user.read'],
  capabilities: ['notion:read', 'notion:write', 'notion:workspace', 'notion:database'],
  permissions: [
    {
      id: 'notion.workspace',
      label: 'View Workspace',
      description: 'See which Notion workspace is connected to this integration.',
      scope: 'data.read',
      capability: 'notion:workspace',
    },
    {
      id: 'notion.read',
      label: 'Read Pages',
      description: 'Search and read pages in your workspace.',
      scope: 'data.read',
      capability: 'notion:read',
    },
    {
      id: 'notion.database',
      label: 'Search Databases',
      description: 'Search for databases in your workspace.',
      scope: 'data.read',
      capability: 'notion:database',
    },
    {
      id: 'notion.write',
      label: 'Create & Update Pages',
      description: 'Create and update pages in your workspace.',
      scope: 'data.write',
      capability: 'notion:write',
    },
  ],
  supportsRefresh: false,
  pkce: true,
  authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
  tokenUrl: 'https://api.notion.com/v1/oauth/token',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    void opts?.scopes;
    const params = new URLSearchParams({
      client_id: config.notionClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
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
      client_id: config.notionClientId,
      client_secret: config.notionClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (opts?.codeVerifier) {
      params.set('code_verifier', opts.codeVerifier);
    }
    return params;
  },
  refreshParams(): URLSearchParams {
    return new URLSearchParams();
  },
  accountName: notionAccountName,
  async healthCheck(token) {
    const account = await notionAccountName(token);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach Notion' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: () => null,
  tokenResponseExpiresIn: () => 0,
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
