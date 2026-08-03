import { FastifyInstance } from 'fastify';
import { healthRoute } from './health.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoute);
}
