import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { requireAuth } from '../lib/auth.js';
import { listPlugins, reloadPlugins } from '../plugins/index.js';

export async function pluginRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/plugins', async () => {
    const plugins = listPlugins().map((plugin) => ({
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      enabled: plugin.manifest.enabled !== false,
      state: plugin.state,
      error: plugin.error,
      tools: plugin.tools,
      loadedAt: plugin.loadedAt,
    }));
    return { count: plugins.length, plugins };
  });

  app.post('/plugins/reload', async () => {
    const result = await reloadPlugins(config.pluginsDir);
    return { reloaded: true, ...result };
  });
}
