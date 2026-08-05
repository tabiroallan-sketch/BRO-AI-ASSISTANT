import type {
  OAuthProviderDef,
  PermissionDef,
  ProviderDef,
  TokenProviderDef,
  WebhookProviderDef,
} from '../types.js';

export type ProviderManifestValidation =
  { ok: true; def: ProviderDef } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  return value as string[];
}

function permissionsField(record: Record<string, unknown>): PermissionDef[] {
  const value = record.permissions;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is PermissionDef => {
    if (!isRecord(entry)) {
      return false;
    }
    return Boolean(stringField(entry, 'id') && stringField(entry, 'label'));
  });
}

/**
 * Runtime validation for providers shipped as bro.provider.* files. Built-in
 * providers are validated by TypeScript; this guards disk-loaded third-party
 * providers with the structural essentials needed by the framework.
 */
export function validateProviderDef(raw: unknown): ProviderManifestValidation {
  if (!isRecord(raw)) {
    return { ok: false, error: 'provider manifest must be an object' };
  }

  const id = stringField(raw, 'id');
  const label = stringField(raw, 'label');
  const description = stringField(raw, 'description') ?? label ?? '';
  const icon = stringField(raw, 'icon') ?? 'external';
  const type = raw.type;
  if (!id || !label) {
    return { ok: false, error: 'provider manifest requires string "id" and "label"' };
  }
  if (type !== 'oauth' && type !== 'webhook' && type !== 'token') {
    return { ok: false, error: 'provider manifest "type" must be "oauth", "webhook", or "token"' };
  }

  const base = {
    id,
    label,
    description,
    icon,
    oauthConfigured: raw.oauthConfigured !== false,
    capabilities: stringArrayField(raw, 'capabilities') ?? [],
    permissions: permissionsField(raw),
  };

  if (type === 'oauth') {
    const authorizationUrl = stringField(raw, 'authorizationUrl');
    const tokenUrl = stringField(raw, 'tokenUrl');
    const scopes = stringArrayField(raw, 'scopes') ?? [];
    if (!authorizationUrl || !tokenUrl) {
      return {
        ok: false,
        error: 'oauth provider manifest requires "authorizationUrl" and "tokenUrl"',
      };
    }
    if (
      typeof raw.authorizationParams !== 'function' ||
      typeof raw.tokenParams !== 'function' ||
      typeof raw.refreshParams !== 'function'
    ) {
      return {
        ok: false,
        error: 'oauth provider manifest requires authorizationParams, tokenParams, refreshParams',
      };
    }
    const def: OAuthProviderDef = {
      ...base,
      type: 'oauth',
      scopes,
      supportsRefresh: raw.supportsRefresh !== false,
      pkce: raw.pkce !== false,
      authorizationUrl,
      tokenUrl,
      authorizationParams: raw.authorizationParams as OAuthProviderDef['authorizationParams'],
      tokenParams: raw.tokenParams as OAuthProviderDef['tokenParams'],
      refreshParams: raw.refreshParams as OAuthProviderDef['refreshParams'],
      ...(typeof raw.revoke === 'function'
        ? { revoke: raw.revoke as OAuthProviderDef['revoke'] }
        : {}),
      accountName:
        typeof raw.accountName === 'function'
          ? (raw.accountName as OAuthProviderDef['accountName'])
          : async (): Promise<string | null> => null,
      healthCheck:
        typeof raw.healthCheck === 'function'
          ? (raw.healthCheck as OAuthProviderDef['healthCheck'])
          : undefined,
      tokenResponseAccessToken:
        typeof raw.tokenResponseAccessToken === 'function'
          ? (raw.tokenResponseAccessToken as OAuthProviderDef['tokenResponseAccessToken'])
          : (body: Record<string, unknown>): string | null =>
              typeof body.access_token === 'string' ? body.access_token : null,
      tokenResponseRefreshToken:
        typeof raw.tokenResponseRefreshToken === 'function'
          ? (raw.tokenResponseRefreshToken as OAuthProviderDef['tokenResponseRefreshToken'])
          : (): string | null => null,
      tokenResponseExpiresIn:
        typeof raw.tokenResponseExpiresIn === 'function'
          ? (raw.tokenResponseExpiresIn as OAuthProviderDef['tokenResponseExpiresIn'])
          : (): number => 3600,
      tokenResponseScope:
        typeof raw.tokenResponseScope === 'function'
          ? (raw.tokenResponseScope as OAuthProviderDef['tokenResponseScope'])
          : (body: Record<string, unknown>): string | null =>
              typeof body.scope === 'string' ? body.scope : null,
    };
    return { ok: true, def };
  }

  if (type === 'webhook') {
    const def: WebhookProviderDef = {
      ...base,
      type: 'webhook',
      healthCheck:
        typeof raw.healthCheck === 'function'
          ? (raw.healthCheck as WebhookProviderDef['healthCheck'])
          : undefined,
    };
    return { ok: true, def };
  }

  const fields = raw.fields;
  if (!Array.isArray(fields)) {
    return { ok: false, error: 'token provider manifest requires a "fields" array' };
  }
  const def: TokenProviderDef = {
    ...base,
    type: 'token',
    fields: fields.map((field) => {
      const record = isRecord(field) ? field : {};
      return {
        name: stringField(record, 'name') ?? '',
        label: stringField(record, 'label') ?? 'Value',
        placeholder: stringField(record, 'placeholder') ?? '',
      };
    }),
    healthCheck:
      typeof raw.healthCheck === 'function'
        ? (raw.healthCheck as TokenProviderDef['healthCheck'])
        : undefined,
  };
  return { ok: true, def };
}
