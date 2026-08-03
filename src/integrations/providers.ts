import { config } from '../config/index.js';

export type OAuthProviderDef = {
  id: string;
  label: string;
  description: string;
  type: 'oauth';
  icon: string;
  oauthConfigured: boolean;
  scopes: string[];
  supportsRefresh: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  authorizationParams(state: string, redirectUri: string): URLSearchParams;
  tokenParams(code: string, redirectUri: string): URLSearchParams;
  refreshParams(refreshToken: string): URLSearchParams;
  accountName(accessToken: string): Promise<string | null>;
  tokenResponseAccessToken(body: Record<string, unknown>): string | null;
  tokenResponseRefreshToken(body: Record<string, unknown>): string | null;
  tokenResponseExpiresIn(body: Record<string, unknown>): number;
  tokenResponseScope(body: Record<string, unknown>): string | null;
};

export type WebhookProviderDef = {
  id: string;
  label: string;
  description: string;
  type: 'webhook';
  icon: string;
  oauthConfigured: true;
};

export type TokenProviderDef = {
  id: string;
  label: string;
  description: string;
  type: 'token';
  icon: string;
  oauthConfigured: boolean;
  fields: { name: string; label: string; placeholder: string }[];
};

export type ProviderDef = OAuthProviderDef | WebhookProviderDef | TokenProviderDef;

function googleCredentialsConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

function redirectUri(providerId: string): string {
  return `${config.integrationRedirectBase}/${providerId}/callback`;
}

const GOOGLE_SCOPE_PREFIX = 'https://www.googleapis.com/auth';

async function googleAccountName(accessToken: string): Promise<string | null> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { email?: string };
  return body.email ?? null;
}

function makeGoogleProvider(
  id: string,
  label: string,
  description: string,
  scopes: string[],
): OAuthProviderDef {
  return {
    id,
    label,
    description,
    type: 'oauth',
    icon: 'google',
    oauthConfigured: googleCredentialsConfigured(),
    scopes,
    supportsRefresh: true,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    authorizationParams(state: string): URLSearchParams {
      return new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: redirectUri(id),
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        prompt: 'consent',
        access_type: 'offline',
        include_granted_scopes: 'true',
      });
    },
    tokenParams(code: string): URLSearchParams {
      return new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri(id),
        grant_type: 'authorization_code',
      });
    },
    refreshParams(refreshToken: string): URLSearchParams {
      return new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        grant_type: 'refresh_token',
      });
    },
    accountName: googleAccountName,
    tokenResponseAccessToken: (body) =>
      typeof body.access_token === 'string' ? body.access_token : null,
    tokenResponseRefreshToken: (body) =>
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    tokenResponseExpiresIn: (body) =>
      typeof body.expires_in === 'number' ? body.expires_in : 3600,
    tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
  };
}

const providers: ProviderDef[] = [
  makeGoogleProvider('google-calendar', 'Google Calendar', 'Read and create calendar events.', [
    `${GOOGLE_SCOPE_PREFIX}/calendar.readonly`,
    `${GOOGLE_SCOPE_PREFIX}/calendar.events`,
  ]),
  makeGoogleProvider('google-gmail', 'Gmail', 'Search and send email.', [
    `${GOOGLE_SCOPE_PREFIX}/gmail.readonly`,
    `${GOOGLE_SCOPE_PREFIX}/gmail.send`,
  ]),
  makeGoogleProvider('google-drive', 'Google Drive', 'List and read files in your Drive.', [
    `${GOOGLE_SCOPE_PREFIX}/drive.readonly`,
  ]),
  {
    id: 'github',
    label: 'GitHub',
    description: 'List repositories and create issues.',
    type: 'oauth',
    icon: 'github',
    oauthConfigured: Boolean(config.githubClientId && config.githubClientSecret),
    scopes: ['repo', 'read:user'],
    supportsRefresh: true,
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    authorizationParams(state: string): URLSearchParams {
      return new URLSearchParams({
        client_id: config.githubClientId,
        redirect_uri: redirectUri('github'),
        scope: 'repo read:user',
        state,
        allow_signup: 'true',
      });
    },
    tokenParams(code: string): URLSearchParams {
      return new URLSearchParams({
        code,
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        redirect_uri: redirectUri('github'),
      });
    },
    refreshParams(refreshToken: string): URLSearchParams {
      return new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        grant_type: 'refresh_token',
      });
    },
    async accountName(accessToken: string): Promise<string | null> {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'bro-assistant',
        },
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { login?: string };
      return body.login ?? null;
    },
    tokenResponseAccessToken: (body) =>
      typeof body.access_token === 'string' ? body.access_token : null,
    tokenResponseRefreshToken: (body) =>
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 0),
    tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Send messages to Slack channels.',
    type: 'oauth',
    icon: 'slack',
    oauthConfigured: Boolean(config.slackClientId && config.slackClientSecret),
    scopes: ['chat:write'],
    supportsRefresh: true,
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    authorizationParams(state: string): URLSearchParams {
      return new URLSearchParams({
        client_id: config.slackClientId,
        redirect_uri: redirectUri('slack'),
        scope: 'chat:write',
        state,
      });
    },
    tokenParams(code: string): URLSearchParams {
      return new URLSearchParams({
        code,
        client_id: config.slackClientId,
        client_secret: config.slackClientSecret,
        redirect_uri: redirectUri('slack'),
      });
    },
    refreshParams(refreshToken: string): URLSearchParams {
      return new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.slackClientId,
        client_secret: config.slackClientSecret,
        grant_type: 'refresh_token',
      });
    },
    async accountName(accessToken: string): Promise<string | null> {
      const response = await fetch('https://slack.com/api/auth.test', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { ok?: boolean; user?: string; team?: string };
      if (!body.ok) {
        return null;
      }
      return [body.user, body.team].filter(Boolean).join(' · ') || 'Slack';
    },
    tokenResponseAccessToken: (body) =>
      typeof body.access_token === 'string' ? body.access_token : null,
    tokenResponseRefreshToken: (body) =>
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    tokenResponseExpiresIn: (body) => (typeof body.expires_in === 'number' ? body.expires_in : 0),
    tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Search and create pages in your workspace.',
    type: 'oauth',
    icon: 'notion',
    oauthConfigured: Boolean(config.notionClientId && config.notionClientSecret),
    scopes: ['data.read', 'data.write', 'user.read'],
    supportsRefresh: false,
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    authorizationParams(state: string): URLSearchParams {
      return new URLSearchParams({
        client_id: config.notionClientId,
        redirect_uri: redirectUri('notion'),
        response_type: 'code',
        owner: 'user',
        state,
      });
    },
    tokenParams(code: string): URLSearchParams {
      return new URLSearchParams({
        code,
        client_id: config.notionClientId,
        client_secret: config.notionClientSecret,
        redirect_uri: redirectUri('notion'),
        grant_type: 'authorization_code',
      });
    },
    refreshParams(): URLSearchParams {
      return new URLSearchParams();
    },
    async accountName(accessToken: string): Promise<string | null> {
      const response = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          authorization: `Bearer ${accessToken}`,
          'notion-version': '2022-06-28',
        },
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { name?: string; id?: string };
      return body.name ?? body.id ?? null;
    },
    tokenResponseAccessToken: (body) =>
      typeof body.access_token === 'string' ? body.access_token : null,
    tokenResponseRefreshToken: () => null,
    tokenResponseExpiresIn: () => 0,
    tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Send messages to a Discord channel via webhook.',
    type: 'webhook',
    icon: 'discord',
    oauthConfigured: true,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Send messages via the WhatsApp Business API.',
    type: 'token',
    icon: 'whatsapp',
    oauthConfigured: true,
    fields: [
      {
        name: 'token',
        label: 'Access token',
        placeholder: 'Permanent WhatsApp Business API token',
      },
      { name: 'phoneNumberId', label: 'Phone number ID', placeholder: 'e.g. 123456789012345' },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return providers.find((p) => p.id === id);
}

export function listProviders(): ProviderDef[] {
  return providers;
}
