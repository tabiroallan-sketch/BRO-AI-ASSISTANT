import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import { getSecret, hasSecret } from '../lib/secrets.js';
import { modelManager, providerRegistry } from '../llm/index.js';
import type { ProviderSettings } from '../llm/index.js';

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

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
    modelManager.setModel(id, model);
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
    return reply.send(result);
  });
}
