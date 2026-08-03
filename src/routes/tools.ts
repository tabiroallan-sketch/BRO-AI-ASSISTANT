import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { listTools } from '../tools/registry.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/tools', async () => {
    const tools = listTools();
    return {
      count: tools.length,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  });
}
