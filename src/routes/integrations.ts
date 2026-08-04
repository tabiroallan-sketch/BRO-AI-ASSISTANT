import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { config } from '../config/index.js';
import { getProvider, listProviders } from '../integrations/providers.js';
import {
  buildProviderAuthorizationUrl,
  exchangeProviderCode,
  fetchProviderAccountName,
  signIntegrationState,
  verifyIntegrationState,
} from '../integrations/oauth.js';
import {
  deleteIntegration,
  listUserIntegrations,
  upsertIntegration,
} from '../integrations/store.js';

const CONNECTED_REDIRECT = (providerId: string): string =>
  `${config.corsOrigin}/settings?integration=${encodeURIComponent(providerId)}&status=connected`;
const ERROR_REDIRECT = (providerId: string, reason: string): string =>
  `${config.corsOrigin}/settings?integration=${encodeURIComponent(providerId)}&status=error&reason=${encodeURIComponent(reason)}`;

export async function publicIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integrations/:provider/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    if (!code) {
      throw new HttpError(400, 'Missing authorization code');
    }

    let payload;
    try {
      payload = await verifyIntegrationState(state ?? '');
    } catch {
      return reply.redirect(ERROR_REDIRECT('unknown', 'invalid_state'));
    }

    const providerId = payload.provider;
    const def = getProvider(providerId);
    if (!def || def.type !== 'oauth') {
      return reply.redirect(ERROR_REDIRECT(providerId, 'unknown_provider'));
    }

    let tokens;
    try {
      tokens = await exchangeProviderCode(providerId, code);
    } catch (error) {
      request.log.error({ err: error }, 'Integration token exchange failed');
      return reply.redirect(ERROR_REDIRECT(providerId, 'token_exchange_failed'));
    }

    const accountName = await fetchProviderAccountName(providerId, tokens.accessToken);
    await upsertIntegration(payload.sub, {
      provider: providerId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
      scopes: tokens.scope,
      accountName,
    });

    return reply.redirect(CONNECTED_REDIRECT(providerId));
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
      };
    });
    return { integrations };
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
      if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        throw new HttpError(400, 'A valid Discord webhook URL is required');
      }
      await upsertIntegration(userId, {
        provider,
        accessToken: webhookUrl,
        accountName: 'Discord webhook',
        metadata: { kind: 'webhook' },
      });
      return reply.status(201).send({ ok: true, connected: true, accountName: 'Discord webhook' });
    }

    if (def.type === 'token') {
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
      if (!token || !phoneNumberId) {
        throw new HttpError(400, 'Both an access token and phone number ID are required');
      }
      await upsertIntegration(userId, {
        provider,
        accessToken: token,
        accountName: `Phone ${phoneNumberId}`,
        metadata: { phoneNumberId },
      });
      return reply
        .status(201)
        .send({ ok: true, connected: true, accountName: `Phone ${phoneNumberId}` });
    }

    throw new HttpError(400, 'Use the connect URL for OAuth providers');
  });

  app.get('/integrations/:provider/connect', async (request, reply) => {
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
      throw new HttpError(400, 'This provider is configured in Settings instead');
    }
    if (!def.oauthConfigured) {
      throw new HttpError(503, `${def.label} OAuth is not configured`);
    }
    const state = await signIntegrationState(userId, provider);
    return reply.redirect(buildProviderAuthorizationUrl(provider, state));
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
