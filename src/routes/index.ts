import { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.js';
import { analyticsRoutes } from './analytics.js';
import { authRoutes } from './auth.js';
import { automationRoutes } from './automations.js';
import { chatRoutes } from './chat.js';
import { conversationRoutes } from './conversations.js';
import { healthRoute } from './health.js';
import { protectedIntegrationRoutes, publicIntegrationRoutes } from './integrations.js';
import { logRoutes } from './logs.js';
import { memoryRoutes } from './memories.js';
import { notificationRoutes } from './notifications.js';
import { pluginRoutes } from './plugins.js';
import { toolRoutes } from './tools.js';

export async function appRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoute);
  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(publicIntegrationRoutes);
      await v1.register(conversationRoutes);
      await v1.register(memoryRoutes);
      await v1.register(chatRoutes);
      await v1.register(notificationRoutes);
      await v1.register(protectedIntegrationRoutes);
      await v1.register(toolRoutes);
      await v1.register(automationRoutes);
      await v1.register(analyticsRoutes);
      await v1.register(logRoutes);
      await v1.register(pluginRoutes);
      await v1.register(adminRoutes);
    },
    { prefix: '/api/v1' },
  );
}
