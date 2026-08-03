import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { chatRoutes } from './chat.js';
import { conversationRoutes } from './conversations.js';
import { healthRoute } from './health.js';
import { memoryRoutes } from './memories.js';
import { notificationRoutes } from './notifications.js';

export async function appRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoute);
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(conversationRoutes);
      await v1.register(memoryRoutes);
      await v1.register(chatRoutes);
      await v1.register(notificationRoutes);
    },
    { prefix: '/api/v1' },
  );
}
