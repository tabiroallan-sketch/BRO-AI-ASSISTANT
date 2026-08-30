import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth, requireRole } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { config, reloadCredentials } from '../config/index.js';
import {
  getAllCredentials,
  saveCredential,
  deleteCredential,
  getCredential,
  invalidateCache,
} from '../integrations/credential-store.js';
import { emitIntegrationEvent } from '../integrations/events.js';
import {
  createAuthorizationUrl,
  exchangeCodeForToken,
  fetchProviderAccountName,
  verifyOAuthState,
} from '../integrations/oauth-engine.js';
import { getGrantedPermissions, getProviderPermissionDefs } from '../integrations/permissions.js';
import { getProvider, listProviders } from '../integrations/providers.js';
import { getLastHealthSweep } from '../integrations/monitor.js';
import {
  deleteIntegration,
  deleteIntegrationAccount,
  getIntegration,
  getValidAccessToken,
  listProviderAccounts,
  listUserIntegrations,
  setAutoReconnect,
  setPrimaryIntegration,
  upsertIntegration,
} from '../integrations/store.js';
import {
  classifyHealthIssue,
  computeConnectionStatus,
  issueLabel,
  testConnection,
} from '../integrations/status.js';
import {
  getIntegrationStatus,
  getPermissionSet,
  listSyncHistory,
  updatePermissionSet,
} from '../integrations/trust-store.js';
import type { ProviderDef } from '../integrations/types.js';

const CONNECTED_REDIRECT = (providerId: string): string =>
  `${config.corsOrigin}/settings?integration=${encodeURIComponent(providerId)}&status=connected`;
const ERROR_REDIRECT = (providerId: string, reason: string): string =>
  `${config.corsOrigin}/settings?integration=${encodeURIComponent(providerId)}&status=error&reason=${encodeURIComponent(reason)}`;

const INTEGRATION_OAUTH_RATE_LIMIT = { max: 20, windowMs: 60_000 } as const;

function splitScopes(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  return value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function buildPermissionCenterProvider(
  userId: string,
  def: ProviderDef,
): Promise<{
  id: string;
  label: string;
  description: string;
  icon: string;
  type: ProviderDef['type'];
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  accountKey: string | null;
  scopes: string | null;
  permissions: Array<{
    id: string;
    label: string;
    description: string;
    scope: string;
    capability: string;
    granted: boolean;
    enabled: boolean;
  }>;
}> {
  const record = await getIntegration(userId, def.id);
  const permissionSet = record ? await getPermissionSet(record.id) : null;
  const grantedByScopes = new Set(
    getGrantedPermissions(def, record?.scopes ?? null)
      .filter((permission) => permission.enabled)
      .map((permission) => permission.id),
  );
  const storedEnabled = permissionSet ? new Set(permissionSet.permissionIds) : null;
  const connected = record !== null;
  const permissions = def.permissions.map((permission) => {
    const granted = def.type === 'oauth' ? grantedByScopes.has(permission.id) : connected;
    const enabled = storedEnabled ? storedEnabled.has(permission.id) : granted;
    return {
      id: permission.id,
      label: permission.label,
      description: permission.description,
      scope: permission.scope,
      capability: permission.capability,
      granted,
      enabled,
    };
  });
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    icon: def.icon,
    type: def.type,
    configured: def.oauthConfigured,
    connected,
    accountName: record?.accountName ?? null,
    accountKey: record?.accountKey ?? null,
    scopes: record?.scopes ?? null,
    permissions,
  };
}

export async function publicIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/integrations/:provider/callback',
    { config: { rateLimit: INTEGRATION_OAUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const { provider } = request.params as { provider: string };
      if (!code) {
        throw new HttpError(400, 'Missing authorization code');
      }

      let payload;
      try {
        payload = await verifyOAuthState(state ?? '');
      } catch {
        return reply.redirect(ERROR_REDIRECT('unknown', 'invalid_state'));
      }

      if (payload.provider !== provider) {
        return reply.redirect(ERROR_REDIRECT(provider, 'invalid_state'));
      }

      const def = getProvider(provider);
      if (!def || def.type !== 'oauth') {
        return reply.redirect(ERROR_REDIRECT(provider, 'unknown_provider'));
      }

      let tokens;
      try {
        tokens = await exchangeCodeForToken(provider, code, {
          codeVerifier: payload.codeVerifier,
          redirectUri: payload.redirectUri,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Integration token exchange failed');
        return reply.redirect(ERROR_REDIRECT(provider, 'token_exchange_failed'));
      }

      const accountName = await fetchProviderAccountName(provider, tokens.accessToken);
      await upsertIntegration(payload.sub, {
        provider,
        accountKey: payload.accountKey,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        scopes: tokens.scope,
        accountName,
      });
      emitIntegrationEvent({
        type: 'connected',
        provider,
        userId: payload.sub,
        accountName,
      });
      recordAudit({
        actorId: payload.sub,
        action: 'integration.connect',
        target: provider,
        detail: `accountKey=${payload.accountKey ?? 'default'}`,
        ip: request.ip,
      });

      return reply.redirect(CONNECTED_REDIRECT(provider));
    },
  );
}

function healthPayload(status: {
  status: string;
  ok: boolean;
  latencyMs: number | null;
  lastMessage: string | null;
  lastHealthCheckAt: Date;
  lastSuccessAt: Date | null;
  code: string | null;
  apiStatus: string | null;
  quota: unknown;
}): Record<string, unknown> | null {
  const issue = status.code ? classifyHealthIssue(status.code) : null;
  return {
    status: status.status,
    issue,
    issueLabel: issue ? issueLabel(issue) : undefined,
    code: status.code,
    ok: status.ok,
    latencyMs: status.latencyMs,
    lastMessage: status.lastMessage,
    lastHealthCheckAt: status.lastHealthCheckAt,
    lastSuccessAt: status.lastSuccessAt,
    apiStatus: status.apiStatus,
    quota: status.quota,
  };
}

function autoReconnectFromMetadata(metadata: unknown): boolean {
  if (typeof metadata === 'object' && metadata !== null) {
    return (metadata as Record<string, unknown>).autoReconnect === true;
  }
  return false;
}

export async function protectedIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/integrations', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const records = await listUserIntegrations(userId);
    const integrations = listProviders().map((provider) => {
      const record = records.get(provider.id) ?? null;
      return {
        id: provider.id,
        label: provider.label,
        description: provider.description,
        type: provider.type,
        icon: provider.icon,
        configured: provider.oauthConfigured,
        connected: record !== null,
        accountName: record?.accountName ?? null,
        accountKey: record?.accountKey ?? null,
        status: computeConnectionStatus(record, provider),
        scopes: record?.scopes ?? null,
        connectedAt: record?.createdAt ?? null,
        tokenExpiresAt: record?.tokenExpiresAt ?? null,
        revokedAt: record?.revokedAt ?? null,
        revokedReason: record?.revokedReason ?? null,
        capabilities: provider.capabilities,
        fields: provider.type === 'token' ? provider.fields : undefined,
        permissions: record
          ? getGrantedPermissions(provider, record.scopes)
          : getProviderPermissionDefs(provider),
      };
    });
    return { integrations };
  });

  app.get('/integrations/permissions', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const providers = await Promise.all(
      listProviders().map((provider) => buildPermissionCenterProvider(userId, provider)),
    );
    return { providers };
  });

  app.get('/integrations/hub', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const records = await listUserIntegrations(userId);
    const providers = await Promise.all(
      listProviders().map(async (provider) => {
        const record = records.get(provider.id) ?? null;
        let health: Record<string, unknown> | null = null;
        let lastSync: Record<string, unknown> | null = null;
        let accountCount = 0;
        if (record) {
          const [status, history, accounts] = await Promise.all([
            getIntegrationStatus(record.id),
            listSyncHistory(userId, provider.id, 1),
            listProviderAccounts(userId, provider.id),
          ]);
          accountCount = accounts.length;
          health = status ? healthPayload(status) : null;
          lastSync = history[0]
            ? {
                id: history[0].id,
                kind: history[0].kind,
                status: history[0].status,
                startedAt: history[0].startedAt,
                finishedAt: history[0].finishedAt,
                itemCount: history[0].itemCount,
                error: history[0].error,
              }
            : null;
        }
        return {
          id: provider.id,
          label: provider.label,
          description: provider.description,
          type: provider.type,
          icon: provider.icon,
          configured: provider.oauthConfigured,
          connected: record !== null,
          accountName: record?.accountName ?? null,
          accountKey: record?.accountKey ?? null,
          status: computeConnectionStatus(record, provider),
          scopes: record?.scopes ?? null,
          connectedAt: record?.createdAt ?? null,
          tokenExpiresAt: record?.tokenExpiresAt ?? null,
          lastRefreshedAt: record?.lastRefreshedAt ?? null,
          refreshCount: record?.refreshCount ?? 0,
          autoReconnect: record ? autoReconnectFromMetadata(record.metadata) : false,
          revokedAt: record?.revokedAt ?? null,
          revokedReason: record?.revokedReason ?? null,
          capabilities: provider.capabilities,
          fields: provider.type === 'token' ? provider.fields : undefined,
          permissions: record
            ? getGrantedPermissions(provider, record.scopes)
            : getProviderPermissionDefs(provider),
          health,
          lastSync,
          accountCount,
        };
      }),
    );
    return { providers };
  });

  app.get('/integrations/health', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const records = await listUserIntegrations(userId);
    const providers = await Promise.all(
      listProviders().map(async (provider) => {
        const record = records.get(provider.id) ?? null;
        let health: Record<string, unknown> | null = null;
        let lastSync: Record<string, unknown> | null = null;
        if (record) {
          const [status, history] = await Promise.all([
            getIntegrationStatus(record.id),
            listSyncHistory(userId, provider.id, 1),
          ]);
          health = status ? healthPayload(status) : null;
          lastSync = history[0]
            ? {
                id: history[0].id,
                kind: history[0].kind,
                status: history[0].status,
                startedAt: history[0].startedAt,
                finishedAt: history[0].finishedAt,
                itemCount: history[0].itemCount,
                error: history[0].error,
              }
            : null;
        }
        return {
          id: provider.id,
          label: provider.label,
          description: provider.description,
          type: provider.type,
          icon: provider.icon,
          configured: provider.oauthConfigured,
          connected: record !== null,
          accountName: record?.accountName ?? null,
          status: computeConnectionStatus(record, provider),
          autoReconnect: record ? autoReconnectFromMetadata(record.metadata) : false,
          tokenExpiresAt: record?.tokenExpiresAt ?? null,
          lastRefreshedAt: record?.lastRefreshedAt ?? null,
          refreshCount: record?.refreshCount ?? 0,
          revokedAt: record?.revokedAt ?? null,
          revokedReason: record?.revokedReason ?? null,
          health,
          lastSync,
        };
      }),
    );
    const summary = {
      connected: providers.filter((provider) => provider.connected).length,
      healthy: providers.filter((provider) => provider.health?.ok === true).length,
      unhealthy: providers.filter((provider) => provider.connected && provider.health?.ok === false)
        .length,
      disconnected: providers.filter((provider) => !provider.connected).length,
      autoReconnectEnabled: providers.filter((provider) => provider.autoReconnect).length,
    };
    return {
      providers,
      summary,
      sweep: getLastHealthSweep(),
      monitor: {
        enabled: config.healthMonitorEnabled,
        intervalMs: config.healthMonitorIntervalMs,
        autoReconnectEnabled: config.autoReconnectEnabled,
      },
    };
  });

  app.put('/integrations/:provider/auto-reconnect', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const enabled = body.enabled === true;
    const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
    const ok = await setAutoReconnect(userId, provider, enabled, accountKey);
    if (!ok) {
      throw new HttpError(404, 'Integration not found');
    }
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.auto_reconnect',
      target: provider,
      detail: JSON.stringify({ enabled, accountKey: accountKey ?? 'default' }),
      ip: request.ip,
    });
    return reply.send({
      ok: true,
      provider: def.id,
      accountKey: accountKey ?? null,
      autoReconnect: enabled,
    });
  });

  app.post('/integrations/:provider', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (def.type === 'webhook') {
      const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';
      const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
      if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        throw new HttpError(400, 'A valid Discord webhook URL is required');
      }
      await upsertIntegration(userId, {
        provider,
        accountKey,
        accessToken: webhookUrl,
        accountName: 'Discord webhook',
        metadata: { kind: 'webhook' },
      });
      emitIntegrationEvent({ type: 'connected', provider, userId, accountName: 'Discord webhook' });
      return reply.status(201).send({ ok: true, connected: true, accountName: 'Discord webhook' });
    }

    if (def.type === 'token') {
      const firstField = def.fields[0];
      if (!firstField) {
        throw new HttpError(400, 'This provider has no configurable fields');
      }
      const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
      const missing: string[] = [];
      const values: Record<string, string> = {};
      for (const field of def.fields) {
        const raw = body[field.name];
        if (typeof raw !== 'string' || raw.trim() === '') {
          missing.push(field.label);
          continue;
        }
        values[field.name] = raw.trim();
      }
      if (missing.length > 0) {
        throw new HttpError(
          400,
          `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`,
        );
      }
      const accessToken = values[firstField.name];
      if (!accessToken) {
        throw new HttpError(400, `${firstField.label} is required`);
      }
      const explicitName =
        typeof body.accountName === 'string' && body.accountName.trim() !== ''
          ? body.accountName.trim()
          : undefined;
      const accountName =
        explicitName ?? def.accountNameFromFields?.(values) ?? `${def.label} connection`;
      await upsertIntegration(userId, {
        provider,
        accountKey,
        accessToken,
        accountName,
        metadata: values,
      });
      emitIntegrationEvent({ type: 'connected', provider, userId, accountName });
      return reply.status(201).send({ ok: true, connected: true, accountName });
    }

    throw new HttpError(400, 'Use the connect URL for OAuth providers');
  });

  app.get('/integrations/:provider/connect', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const { accountKey, scopes } = request.query as { accountKey?: string; scopes?: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    if (def.type !== 'oauth') {
      throw new HttpError(400, 'This provider is configured in Settings instead');
    }
    if (!def.oauthConfigured) {
      throw new HttpError(503, `${def.label} OAuth is not configured`);
    }
    const { url } = await createAuthorizationUrl({
      userId,
      providerId: provider,
      accountKey,
      scopes: splitScopes(scopes),
    });
    return reply.redirect(url);
  });

  app.post('/integrations/:provider/reconnect', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    if (def.type !== 'oauth') {
      throw new HttpError(400, 'Reconnect is only supported for OAuth providers');
    }
    if (!def.oauthConfigured) {
      throw new HttpError(503, `${def.label} OAuth is not configured`);
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
    const { url } = await createAuthorizationUrl({
      userId,
      providerId: provider,
      accountKey,
      scopes: splitScopes(body.scopes),
    });
    const existing = await getIntegration(userId, provider, accountKey);
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: existing ? 'integration.reconnect' : 'integration.connect',
      target: provider,
      detail: `accountKey=${accountKey ?? 'default'}`,
      ip: request.ip,
    });
    return reply.send({
      ok: true,
      provider: def.id,
      accountKey: accountKey ?? null,
      url,
    });
  });

  app.get('/integrations/:provider/permissions', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const record = await getIntegration(userId, provider);
    const permissions = record
      ? getGrantedPermissions(def, record.scopes)
      : getProviderPermissionDefs(def);
    return { provider: def.id, connected: record !== null, permissions };
  });

  app.put('/integrations/:provider/permissions', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const record = await getIntegration(userId, provider);
    if (!record) {
      throw new HttpError(404, 'Integration not found');
    }
    const body = (request.body ?? {}) as { permissions?: unknown };
    const requested = Array.isArray(body.permissions)
      ? body.permissions.filter((value): value is string => typeof value === 'string')
      : [];
    const validIds = new Set(def.permissions.map((permission) => permission.id));
    const enabledIds = [...new Set(requested.filter((id) => validIds.has(id)))];
    await updatePermissionSet(record.id, enabledIds);
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.permissions.update',
      target: record.id,
      detail: JSON.stringify({ provider, permissions: enabledIds }),
      ip: request.ip,
    });
    return reply.send({
      ok: true,
      provider: def.id,
      permissions: await buildPermissionCenterProvider(userId, def),
    });
  });

  app.post('/integrations/:provider/test', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const result = await testConnection(userId, provider);
    return {
      ok: result.ok,
      accountName: result.accountName,
      message: result.message,
      latencyMs: result.latencyMs,
    };
  });

  app.post('/integrations/:provider/refresh', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    if (def.type !== 'oauth') {
      throw new HttpError(400, 'Token refresh is only supported for OAuth providers');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
    const before = await getIntegration(userId, provider, accountKey);
    if (!before) {
      throw new HttpError(404, 'Integration not found');
    }
    const token = await getValidAccessToken(userId, provider, accountKey);
    const after = await getIntegration(userId, provider, accountKey);
    if (!token || !after) {
      const status = computeConnectionStatus(after ?? before, def);
      return reply.status(409).send({
        ok: false,
        provider: def.id,
        accountKey: before.accountKey,
        status,
        message:
          status === 'revoked'
            ? 'Account revoked: refresh token reuse detected'
            : 'Token refresh failed',
      });
    }
    return {
      ok: true,
      provider: def.id,
      accountKey: after.accountKey,
      status: computeConnectionStatus(after, def),
      tokenExpiresAt: after.tokenExpiresAt,
      lastRefreshedAt: after.lastRefreshedAt,
      refreshCount: after.refreshCount,
    };
  });

  app.get('/integrations/:provider/accounts', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const accounts = await listProviderAccounts(userId, provider);
    return {
      provider: def.id,
      count: accounts.length,
      accounts: accounts.map((account) => ({
        id: account.id,
        accountKey: account.accountKey,
        accountName: account.accountName,
        isPrimary: account.isPrimary,
        status: computeConnectionStatus(account, def),
        scopes: account.scopes,
        connectedAt: account.createdAt,
        tokenExpiresAt: account.tokenExpiresAt,
        lastRefreshedAt: account.lastRefreshedAt,
        refreshCount: account.refreshCount,
        revokedAt: account.revokedAt,
        revokedReason: account.revokedReason,
      })),
    };
  });

  app.post('/integrations/:provider/accounts/:accountId/primary', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider, accountId } = request.params as {
      provider: string;
      accountId: string;
    };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const ok = await setPrimaryIntegration(userId, provider, accountId);
    if (!ok) {
      throw new HttpError(404, 'Integration account not found');
    }
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.primary.change',
      target: accountId,
      detail: `provider=${provider}`,
      ip: request.ip,
    });
    return reply.send({ ok: true, provider: def.id, primary: accountId });
  });

  app.delete('/integrations/:provider/accounts/:accountId', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider, accountId } = request.params as {
      provider: string;
      accountId: string;
    };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const ok = await deleteIntegrationAccount(
      userId,
      provider,
      accountId,
      def.type === 'oauth' ? def.revoke : undefined,
    );
    if (!ok) {
      throw new HttpError(404, 'Integration account not found');
    }
    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.disconnect',
      target: `${provider}:${accountId}`,
      ip: request.ip,
    });
    return reply.status(204).send();
  });

  app.get('/integrations/:provider/status', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const record = await getIntegration(userId, provider);
    if (!record) {
      return {
        provider: def.id,
        connected: false,
        status: computeConnectionStatus(null, def),
        health: null,
        permissions: null,
      };
    }
    const [status, permissionSet] = await Promise.all([
      getIntegrationStatus(record.id),
      getPermissionSet(record.id),
    ]);
    return {
      provider: def.id,
      connected: true,
      accountName: record.accountName,
      accountKey: record.accountKey,
      status: computeConnectionStatus(record, def),
      autoReconnect: autoReconnectFromMetadata(record.metadata),
      revokedAt: record.revokedAt,
      revokedReason: record.revokedReason,
      lastRefreshedAt: record.lastRefreshedAt,
      refreshCount: record.refreshCount,
      health: status ? healthPayload(status) : null,
      permissions: permissionSet
        ? {
            scopes: permissionSet.scopes,
            permissionIds: permissionSet.permissionIds,
            grantedAt: permissionSet.grantedAt,
          }
        : null,
    };
  });

  app.get('/integrations/:provider/sync-history', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    const query = request.query as { limit?: string };
    const parsed = Number.parseInt(query.limit ?? '20', 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    const history = await listSyncHistory(userId, provider, limit);
    return { provider: def.id, count: history.length, history };
  });

  app.delete('/integrations/:provider', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { provider } = request.params as { provider: string };
    const def = getProvider(provider);
    if (!def) {
      throw new HttpError(404, 'Unknown integration provider');
    }
    await deleteIntegration(userId, provider);
    return reply.status(204).send();
  });

  // ── Admin credential management ─────────────────────────────────────────

  app.get('/integrations/admin/credentials', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    await requireRole('ADMIN')(request);

    const all = await getAllCredentials();
    // Strip secrets from response — show only metadata
    const safe: Record<string, Record<string, unknown>> = {};
    for (const [providerId, cred] of Object.entries(all)) {
      safe[providerId] = {
        hasClientId: Boolean(cred.clientId),
        hasClientSecret: Boolean(cred.clientSecret),
        hasApiKey: Boolean(cred.apiKey),
        hasWebhookUrl: Boolean(cred.webhookUrl),
        hasAccessToken: Boolean(cred.accessToken),
        updatedAt: cred.updatedAt,
      };
    }
    return { credentials: safe };
  });

  app.get('/integrations/admin/credentials/:provider', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    await requireRole('ADMIN')(request);

    const { provider } = request.params as { provider: string };
    const cred = await getCredential(provider);
    if (!cred) return { credential: null };
    // Strip secrets — return only metadata + which fields exist
    return {
      credential: {
        hasClientId: Boolean(cred.clientId),
        hasClientSecret: Boolean(cred.clientSecret),
        hasApiKey: Boolean(cred.apiKey),
        hasWebhookUrl: Boolean(cred.webhookUrl),
        hasAccessToken: Boolean(cred.accessToken),
        updatedAt: cred.updatedAt,
      },
    };
  });

  app.put('/integrations/admin/credentials/:provider', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    await requireRole('ADMIN')(request);

    const { provider } = request.params as { provider: string };
    const body = (request.body ?? {}) as Record<string, string>;

    const data: Record<string, string | undefined> = {};
    if (typeof body.clientId === 'string') data.clientId = body.clientId.trim();
    if (typeof body.clientSecret === 'string') data.clientSecret = body.clientSecret.trim();
    if (typeof body.apiKey === 'string') data.apiKey = body.apiKey.trim();
    if (typeof body.webhookUrl === 'string') data.webhookUrl = body.webhookUrl.trim();
    if (typeof body.accessToken === 'string') data.accessToken = body.accessToken.trim();

    // Require at least one field
    const hasAny =
      data.clientId || data.clientSecret || data.apiKey || data.webhookUrl || data.accessToken;
    if (!hasAny) {
      throw new HttpError(400, 'Provide at least one credential field');
    }

    await saveCredential(provider, {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      apiKey: data.apiKey,
      webhookUrl: data.webhookUrl,
      accessToken: data.accessToken,
    });

    // Reload credentials into config so providers pick them up
    invalidateCache();
    await reloadCredentials();

    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.connect',
      target: provider,
      detail: JSON.stringify({ action: 'admin_credential_save' }),
      ip: request.ip,
    });

    return reply.status(200).send({ ok: true, provider });
  });

  app.delete('/integrations/admin/credentials/:provider', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized');
    await requireRole('ADMIN')(request);

    const { provider } = request.params as { provider: string };
    const deleted = await deleteCredential(provider);
    if (!deleted) throw new HttpError(404, 'No credentials found for this provider');

    invalidateCache();
    await reloadCredentials();

    recordAudit({
      actorId: request.user?.id,
      actorEmail: request.user?.email,
      action: 'integration.disconnect',
      target: provider,
      detail: JSON.stringify({ action: 'admin_credential_delete' }),
      ip: request.ip,
    });

    return reply.status(204).send();
  });
}
