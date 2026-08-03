import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { clearLogBuffer, getRecentLogs } from '../lib/log-buffer.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/logs', async (request) => {
    const query = request.query as { limit?: string };
    const parsed = Number.parseInt(query.limit ?? '200', 10);
    const limit = Number.isFinite(parsed) ? parsed : 200;
    return { logs: getRecentLogs(limit) };
  });

  app.delete('/logs', async (_request, reply) => {
    clearLogBuffer();
    return reply.status(204).send();
  });
}
