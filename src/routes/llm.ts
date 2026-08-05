import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth, requireRole } from '../lib/auth.js';
import { getSecret, hasSecret } from '../lib/secrets.js';
import { aiConfigStore, modelManager, providerRegistry } from '../llm/index.js';
import type { ProviderSettings } from '../llm/index.js';

type LLMSettingsResponse = {
  providerId: string | null;
  model: string | null;
  hasApiKey: boolean;
  activeProvider: {
    id: string;
    label: string;
    description: string;
    requiresApiKey: boolean;
    envVar: string;
    configured: boolean;
    defaultModel: string | null;
    defaultBaseUrl: string | null;
  } | null;
  status: string | null;
  message: string | null;
  latencyMs: number | null;
  lastTestedAt: Date | null;
};

async function settingsResponse(): Promise<LLMSettingsResponse> {
  const row = await aiConfigStore.get();
  const descriptor = row.providerId ? providerRegistry.get(row.providerId)?.descriptor : undefined;
  return {
    providerId: row.providerId,
    model: row.model,
    hasApiKey: row.apiKey !== null,
    activeProvider: descriptor
      ? {
          id: descriptor.id,
          label: descriptor.label,
          description: descriptor.description,
          requiresApiKey: descriptor.requiresApiKey,
          envVar: descriptor.envVar,
          configured: descriptor.requiresApiKey ? hasSecret(descriptor.envVar) : true,
          defaultModel: descriptor.defaultModel ?? null,
          defaultBaseUrl: descriptor.defaultBaseUrl ?? null,
        }
      : null,
    status: row.lastStatus,
    message: row.lastMessage,
    latencyMs: row.lastLatencyMs,
    lastTestedAt: row.lastTestedAt,
  };
}

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/llm/settings', async () => settingsResponse());

  app.put('/llm/settings', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : undefined;
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
    if (providerId && !providerRegistry.has(providerId)) {
      throw new HttpError(400, 'Unknown LLM provider');
    }
    if (apiKey && !providerId) {
      throw new HttpError(400, 'A provider is required to save an API key');
    }
    await aiConfigStore.save({
      ...(providerId !== undefined ? { providerId } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    return settingsResponse();
  });

  app.delete('/llm/settings/api-key', async () => {
    await aiConfigStore.clearApiKey();
    return settingsResponse();
  });

  app.get('/llm/providers', async () => {
    const providers = providerRegistry.list().map((provider) => {
      const descriptor = provider.descriptor;
      return {
        id: descriptor.id,
        label: descriptor.label,
        description: descriptor.description,
        requiresApiKey: descriptor.requiresApiKey,
        envVar: descriptor.envVar,
        configured: descriptor.requiresApiKey ? hasSecret(descriptor.envVar) : true,
        defaultModel: descriptor.defaultModel ?? null,
        defaultBaseUrl: descriptor.defaultBaseUrl ?? null,
      };
    });
    return { providers };
  });

  app.get('/llm/providers/:id/models', async (request) => {
    const { id } = request.params as { id: string };
    if (!providerRegistry.has(id)) {
      throw new HttpError(404, 'Unknown LLM provider');
    }
    const models = await modelManager.listModels(id);
    return { models, defaultModel: modelManager.getDefaultModel(id) ?? null };
  });

  app.post('/llm/providers/:id/model', async (request) => {
    const { id } = request.params as { id: string };
    if (!providerRegistry.has(id)) {
      throw new HttpError(404, 'Unknown LLM provider');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) {
      throw new HttpError(400, 'A model id is required');
    }
    await aiConfigStore.save({ providerId: id, model });
    return { model };
  });

  app.post('/llm/providers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = providerRegistry.get(id);
    if (!provider) {
      throw new HttpError(404, 'Unknown LLM provider');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const descriptor = provider.descriptor;
    const settings: ProviderSettings = {};
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : descriptor.requiresApiKey
          ? getSecret(descriptor.envVar)
          : '';
    if (apiKey) {
      settings.apiKey = apiKey;
    }
    if (typeof body.model === 'string' && body.model.trim()) {
      settings.model = body.model.trim();
    }
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
      settings.baseUrl = body.baseUrl.trim();
    }
    const result = await provider.testConnection(settings);
    await aiConfigStore.recordTestResult(result);
    return reply.send(result);
  });
}
