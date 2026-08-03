import type { FastifyInstance } from 'fastify';
import { getHealthReport } from '../lib/health.js';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const report = await getHealthReport();
    const code = report.status === 'ok' ? 200 : 503;
    return reply.status(code).send(report);
  });
}
