import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import type { OAuthProviderDef } from '../../types.js';

const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.content.read',
  'files.content.write',
];

async function dropboxAccountName(accessToken: string): Promise<string | null> {
  const response = await fetchWithTimeout(
    'https://api.dropboxapi.com/2/users/get_current_account',
    {
      timeoutMs: 10_000,
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    name?: { display_name?: string };
    email?: string;
  };
  return [body.name?.display_name, body.email].filter(Boolean).join(' · ') || 'Dropbox';
}

export const dropboxProvider: OAuthProviderDef = {
  id: 'dropbox',
  label: 'Dropbox',
  description: 'List, read, and upload files in your Dropbox.',
  type: 'oauth',
  icon: 'dropbox',
  oauthConfigured: Boolean(config.dropboxClientId && config.dropboxClientSecret),
  scopes: DROPBOX_SCOPES,
  capabilities: ['dropbox:files', 'dropbox:account'],
  permissions: [
    {
      id: 'dropbox.files.read',
      label: 'Read Files',
      description: 'List and read the contents of your Dropbox files and folders.',
      scope: 'files.metadata.read files.content.read',
      capability: 'dropbox:files',
    },
    {
      id: 'dropbox.files.write',
      label: 'Upload Files',
      description: 'Upload and update files in your Dropbox.',
      scope: 'files.content.write',
      capability: 'dropbox:files',
    },
    {
      id: 'dropbox.account',
      label: 'Account Info',
      description: 'Read your Dropbox account name and email.',
      scope: 'account_info.read',
      capability: 'dropbox:account',
    },
  ],
  supportsRefresh: true,
  pkce: true,
  authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  authorizationParams(
    state: string,
    redirectUri: string,
    opts?: { codeChallenge?: string; scopes?: string[] },
  ): URLSearchParams {
    const params = new URLSearchParams({
      client_id: config.dropboxClientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      // Ask Dropbox for a long-lived refresh token; the default short-lived
      // access token alone cannot be renewed.
      token_access_type: 'offline',
    });
    const scopes = opts?.scopes ?? DROPBOX_SCOPES;
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
      client_id: config.dropboxClientId,
      client_secret: config.dropboxClientSecret,
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
      client_id: config.dropboxClientId,
      client_secret: config.dropboxClientSecret,
    });
  },
  accountName: dropboxAccountName,
  async healthCheck(token) {
    const account = await dropboxAccountName(token);
    return {
      ok: account !== null,
      accountName: account,
      message: account === null ? 'Could not reach Dropbox' : null,
    };
  },
  tokenResponseAccessToken: (body) =>
    typeof body.access_token === 'string' ? body.access_token : null,
  tokenResponseRefreshToken: (body) =>
    typeof body.refresh_token === 'string' ? body.refresh_token : null,
  tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 14400),
  tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
};
