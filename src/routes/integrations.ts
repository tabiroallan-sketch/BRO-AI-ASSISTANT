import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { config } from '../config/index.js';
import { emitIntegrationEvent } from '../integrations/events.js';
import {
  createAuthorizationUrl,
  exchangeCodeForToken,
  fetchProviderAccountName,
  verifyOAuthState,
} from '../integrations/oauth-engine.js';
import { getGrantedPermissions, getProviderPermissionDefs } from '../integrations/permissions.js';
import { getProvider, listProviders } from '../integrations/providers.js';
import {
  deleteIntegration,
  deleteIntegrationAccount,
  getIntegration,
  getValidAccessToken,
  listProviderAccounts,
  listUserIntegrations,
  setPrimaryIntegration,
  upsertIntegration,
} from '../integrations/store.js';
import { computeConnectionStatus, testConnection } from '../integrations/status.js';
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
  app.get('/integrations/:provider/callback', async (request, reply) => {
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

    return reply.redirect(CONNECTED_REDIRECT(provider));
  });
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
          health = status
            ? {
                status: status.status,
                ok: status.ok,
                latencyMs: status.latencyMs,
                lastMessage: status.lastMessage,
                lastHealthCheckAt: status.lastHealthCheckAt,
                lastSuccessAt: status.lastSuccessAt,
              }
            : null;
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
          revokedAt: record?.revokedAt ?? null,
          revokedReason: record?.revokedReason ?? null,
          capabilities: provider.capabilities,
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
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
      const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : undefined;
      if (!token || !phoneNumberId) {
        throw new HttpError(400, 'Both an access token and phone number ID are required');
      }
      const accountName = `Phone ${phoneNumberId}`;
      await upsertIntegration(userId, {
        provider,
        accountKey,
        accessToken: token,
        accountName,
        metadata: { phoneNumberId },
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
      revokedAt: record.revokedAt,
      revokedReason: record.revokedReason,
      lastRefreshedAt: record.lastRefreshedAt,
      refreshCount: record.refreshCount,
      health: status
        ? {
            status: status.status,
            ok: status.ok,
            latencyMs: status.latencyMs,
            lastMessage: status.lastMessage,
            lastHealthCheckAt: status.lastHealthCheckAt,
            lastSuccessAt: status.lastSuccessAt,
          }
        : null,
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
}
