import type { FastifyInstance } from 'fastify';
import { HttpError, requireAuth } from '../lib/auth.js';
import {
  buildMarketplace,
  getCatalogItem,
  installItem,
  uninstallItem,
  updateItem,
} from '../integrations/marketplace.js';

export async function protectedMarketplaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/integrations/marketplace', async (request) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    return buildMarketplace(userId);
  });

  app.post('/integrations/marketplace/:itemId/install', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { itemId } = request.params as { itemId: string };
    if (!getCatalogItem(itemId)) {
      throw new HttpError(404, 'Unknown marketplace item');
    }
    const item = await installItem(itemId, userId);
    return reply.send({ ok: true, item });
  });

  app.post('/integrations/marketplace/:itemId/update', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { itemId } = request.params as { itemId: string };
    if (!getCatalogItem(itemId)) {
      throw new HttpError(404, 'Unknown marketplace item');
    }
    const result = await updateItem(itemId);
    return reply.send({ ok: true, ...result });
  });

  app.delete('/integrations/marketplace/:itemId', async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized');
    }
    const { itemId } = request.params as { itemId: string };
    if (!getCatalogItem(itemId)) {
      throw new HttpError(404, 'Unknown marketplace item');
    }
    const item = await uninstallItem(itemId, userId);
    return reply.send({ ok: true, item });
  });
}
