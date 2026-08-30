import { config } from '../../../config/index.js';
import { fetchWithTimeout } from '../../../lib/http.js';
import { isProviderConfigured } from '../../credential-store.js';
import type { HealthProbe, OAuthProviderDef, ProviderCapability } from '../../types.js';

const GOOGLE_SCOPE_PREFIX = 'https://www.googleapis.com/auth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function googleCredentialsConfigured(): boolean {
  return isProviderConfigured('google', config.googleClientId, config.googleClientSecret);
}

async function googleAccountName(accessToken: string): Promise<string | null> {
  const response = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
    timeoutMs: 10_000,
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
  capabilities: ProviderCapability[],
  permissions: OAuthProviderDef['permissions'],
): OAuthProviderDef {
  return {
    id,
    label,
    description,
    type: 'oauth',
    icon: 'google',
    oauthConfigured: googleCredentialsConfigured(),
    scopes,
    capabilities,
    permissions,
    supportsRefresh: true,
    pkce: true,
    authorizationUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    authorizationParams(
      state: string,
      redirectUri: string,
      opts?: { codeChallenge?: string; scopes?: string[] },
    ): URLSearchParams {
      const requested = opts?.scopes ?? scopes;
      const params = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: requested.join(' '),
        state,
        prompt: 'consent',
        access_type: 'offline',
        include_granted_scopes: 'true',
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
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      if (opts?.codeVerifier) {
        params.set('code_verifier', opts.codeVerifier);
      }
      return params;
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
    async healthCheck(token: string): Promise<HealthProbe> {
      const account = await googleAccountName(token);
      return {
        ok: account !== null,
        accountName: account,
        message: account === null ? 'Could not reach Google' : null,
      };
    },
    tokenResponseAccessToken: (body) =>
      typeof body.access_token === 'string' ? body.access_token : null,
    tokenResponseRefreshToken: (body) =>
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    tokenResponseExpiresIn: (body) =>
      typeof body.expires_in === 'number' ? body.expires_in : 3600,
    tokenResponseScope: (body) => (typeof body.scope === 'string' ? body.scope : null),
  };
}

export const googleProviders: OAuthProviderDef[] = [
  makeGoogleProvider(
    'google-calendar',
    'Google Calendar',
    'Read and create calendar events.',
    [`${GOOGLE_SCOPE_PREFIX}/calendar.readonly`, `${GOOGLE_SCOPE_PREFIX}/calendar.events`],
    ['calendar:read', 'calendar:write'],
    [
      {
        id: 'calendar.read',
        label: 'Read Calendar',
        description: 'Read your calendar events.',
        scope: `${GOOGLE_SCOPE_PREFIX}/calendar.readonly`,
        capability: 'calendar:read',
      },
      {
        id: 'calendar.write',
        label: 'Create Events',
        description: 'Create events on your calendar.',
        scope: `${GOOGLE_SCOPE_PREFIX}/calendar.events`,
        capability: 'calendar:write',
      },
    ],
  ),
  makeGoogleProvider(
    'google-gmail',
    'Gmail',
    'Search, read, send, and manage email.',
    [
      `${GOOGLE_SCOPE_PREFIX}/gmail.readonly`,
      `${GOOGLE_SCOPE_PREFIX}/gmail.send`,
      `${GOOGLE_SCOPE_PREFIX}/gmail.modify`,
    ],
    ['gmail:read', 'gmail:send', 'gmail:modify'],
    [
      {
        id: 'gmail.read',
        label: 'Read Gmail',
        description: 'Search and read your emails.',
        scope: `${GOOGLE_SCOPE_PREFIX}/gmail.readonly`,
        capability: 'gmail:read',
      },
      {
        id: 'gmail.send',
        label: 'Send Gmail',
        description: 'Send emails from your account.',
        scope: `${GOOGLE_SCOPE_PREFIX}/gmail.send`,
        capability: 'gmail:send',
      },
      {
        id: 'gmail.modify',
        label: 'Modify Gmail',
        description: 'Mark emails read/unread, star, archive, and manage labels.',
        scope: `${GOOGLE_SCOPE_PREFIX}/gmail.modify`,
        capability: 'gmail:modify',
      },
    ],
  ),
  makeGoogleProvider(
    'google-drive',
    'Google Drive',
    'List, read, upload, move, copy, and delete files in your Drive.',
    [
      `${GOOGLE_SCOPE_PREFIX}/drive.readonly`,
      `${GOOGLE_SCOPE_PREFIX}/drive.file`,
      `${GOOGLE_SCOPE_PREFIX}/drive`,
    ],
    ['drive:read', 'drive:write', 'drive:manage'],
    [
      {
        id: 'drive.read',
        label: 'Read Drive',
        description: 'List and read files in your Google Drive.',
        scope: `${GOOGLE_SCOPE_PREFIX}/drive.readonly`,
        capability: 'drive:read',
      },
      {
        id: 'drive.write',
        label: 'Upload Files',
        description: 'Upload new files to your Google Drive.',
        scope: `${GOOGLE_SCOPE_PREFIX}/drive.file`,
        capability: 'drive:write',
      },
      {
        id: 'drive.manage',
        label: 'Manage Files',
        description: 'Delete, move, copy, and manage files in your Google Drive.',
        scope: `${GOOGLE_SCOPE_PREFIX}/drive`,
        capability: 'drive:manage',
      },
    ],
  ),
  makeGoogleProvider(
    'google-docs',
    'Google Docs',
    'Find, read, create, and edit Google Documents.',
    [`${GOOGLE_SCOPE_PREFIX}/documents`, `${GOOGLE_SCOPE_PREFIX}/drive.readonly`],
    ['docs:read', 'docs:write'],
    [
      {
        id: 'docs.read',
        label: 'Read Documents',
        description: 'Read the text content of your Google Documents.',
        scope: `${GOOGLE_SCOPE_PREFIX}/documents`,
        capability: 'docs:read',
      },
      {
        id: 'docs.list',
        label: 'Find Documents',
        description: 'Locate your Google Documents by name in Drive.',
        scope: `${GOOGLE_SCOPE_PREFIX}/drive.readonly`,
        capability: 'docs:read',
      },
      {
        id: 'docs.write',
        label: 'Edit Documents',
        description: 'Create and edit Google Documents.',
        scope: `${GOOGLE_SCOPE_PREFIX}/documents`,
        capability: 'docs:write',
      },
    ],
  ),
  makeGoogleProvider(
    'google-sheets',
    'Google Sheets',
    'Find, read, create, and edit spreadsheets.',
    [`${GOOGLE_SCOPE_PREFIX}/spreadsheets`, `${GOOGLE_SCOPE_PREFIX}/drive.readonly`],
    ['sheets:read', 'sheets:write'],
    [
      {
        id: 'sheets.read',
        label: 'Read Sheets',
        description: 'Read cell values from your Google Sheets.',
        scope: `${GOOGLE_SCOPE_PREFIX}/spreadsheets`,
        capability: 'sheets:read',
      },
      {
        id: 'sheets.list',
        label: 'Find Spreadsheets',
        description: 'Locate your Google Sheets by name in Drive.',
        scope: `${GOOGLE_SCOPE_PREFIX}/drive.readonly`,
        capability: 'sheets:read',
      },
      {
        id: 'sheets.write',
        label: 'Write Sheets',
        description: 'Write, append, and create spreadsheets.',
        scope: `${GOOGLE_SCOPE_PREFIX}/spreadsheets`,
        capability: 'sheets:write',
      },
    ],
  ),
  makeGoogleProvider(
    'google-tasks',
    'Google Tasks',
    'List and create tasks in your Google Tasks.',
    [`${GOOGLE_SCOPE_PREFIX}/tasks.readonly`, `${GOOGLE_SCOPE_PREFIX}/tasks`],
    ['tasks:read', 'tasks:write'],
    [
      {
        id: 'tasks.read',
        label: 'Read Tasks',
        description: 'List your Google Tasks and task lists.',
        scope: `${GOOGLE_SCOPE_PREFIX}/tasks.readonly`,
        capability: 'tasks:read',
      },
      {
        id: 'tasks.write',
        label: 'Create Tasks',
        description: 'Create tasks in your Google Tasks.',
        scope: `${GOOGLE_SCOPE_PREFIX}/tasks`,
        capability: 'tasks:write',
      },
    ],
  ),
  makeGoogleProvider(
    'google-contacts',
    'Google Contacts',
    'Search and read your Google Contacts.',
    [`${GOOGLE_SCOPE_PREFIX}/contacts.readonly`],
    ['contacts:read'],
    [
      {
        id: 'contacts.read',
        label: 'Read Contacts',
        description: 'Search and read your Google Contacts.',
        scope: `${GOOGLE_SCOPE_PREFIX}/contacts.readonly`,
        capability: 'contacts:read',
      },
    ],
  ),
  makeGoogleProvider(
    'google-slides',
    'Google Slides',
    'Find, read, create, and edit Google Slides presentations.',
    [`${GOOGLE_SCOPE_PREFIX}/presentations`, `${GOOGLE_SCOPE_PREFIX}/drive.readonly`],
    ['slides:read', 'slides:write'],
    [
      {
        id: 'slides.read',
        label: 'Read Presentations',
        description: 'Read and find your Google Slides presentations.',
        scope: `${GOOGLE_SCOPE_PREFIX}/presentations`,
        capability: 'slides:read',
      },
      {
        id: 'slides.write',
        label: 'Edit Presentations',
        description: 'Create and edit Google Slides presentations.',
        scope: `${GOOGLE_SCOPE_PREFIX}/presentations`,
        capability: 'slides:write',
      },
    ],
  ),
];
