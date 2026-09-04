import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { createPinoStream } from './config/logging.js';
import { HttpError } from './lib/auth.js';
import { isOriginAllowed } from './lib/cors.js';
import { prisma } from './lib/prisma.js';
import { applyRateLimits } from './lib/rate-limit.js';
import { redis } from './lib/redis.js';
import { aiConfigStore } from './llm/index.js';
import { loadPluginsFromDisk } from './plugins/index.js';
import { loadProvidersFromDisk } from './integrations/providers/loader.js';
import { applyMarketplaceState } from './integrations/marketplace.js';
import { startHealthMonitor, stopHealthMonitor } from './integrations/monitor.js';
import { startProactiveMonitor, stopProactiveMonitor } from './proactive/index.js';
import { appRoutes } from './routes/index.js';
import './tools/index.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      stream: createPinoStream(config.logLevel),
    },
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    routerOptions: {
      maxParamLength: 1000,
    },
  });

  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  app.register(cookie, {
    secret: config.cookieSecret || undefined,
  });

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      return callback(null, isOriginAllowed(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'BRO API',
        description: 'AI Assistant Platform API',
        version: config.appVersion,
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Development',
        },
      ],
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  app.register(appRoutes);

  app.addHook('onRequest', async (request, _reply) => {
    if (request.raw.url && request.raw.url.length > config.maxRequestUrlLength) {
      throw new HttpError(414, 'Request URL is too long');
    }
  });

  app.addHook('onRequest', async (request, _reply) => {
    if (!config.csrfProtectionEnabled) {
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const origin = request.headers.origin;
    if (!origin) {
      return;
    }
    if (!isOriginAllowed(origin)) {
      throw new HttpError(403, 'Cross-origin request rejected');
    }
  });

  applyRateLimits(app);

  app.addHook('onReady', async () => {
    const result = await loadPluginsFromDisk(config.pluginsDir);
    app.log.info(
      {
        loaded: result.loaded.map((plugin) => plugin.name),
        skipped: result.skipped,
        failed: result.failed.map(({ file }) => file),
      },
      'Plugin loading complete',
    );
    const providerResult = await loadProvidersFromDisk(config.integrationProvidersDir);
    app.log.info(
      {
        loaded: providerResult.loaded,
        failed: providerResult.failed.map(({ file }) => file),
      },
      'Integration provider loading complete',
    );
    if (process.env.VITEST !== 'true') {
      await applyMarketplaceState();
    }
    if (
      process.env.VITEST !== 'true' &&
      config.healthMonitorEnabled &&
      config.databaseUrl &&
      config.healthMonitorIntervalMs > 0
    ) {
      startHealthMonitor(config.healthMonitorIntervalMs);
      app.log.info(
        { intervalMs: config.healthMonitorIntervalMs },
        'Integration health monitor started',
      );
    }
    if (
      process.env.VITEST !== 'true' &&
      config.proactiveMonitorEnabled &&
      config.databaseUrl &&
      config.proactiveMonitorIntervalMs > 0
    ) {
      startProactiveMonitor(config.proactiveMonitorIntervalMs);
      app.log.info({ intervalMs: config.proactiveMonitorIntervalMs }, 'Proactive monitor started');
    }
    try {
      await aiConfigStore.loadIntoRuntime();
      app.log.info('AI config loaded into runtime');
    } catch (error) {
      app.log.warn({ err: error }, 'Failed to load AI config into runtime');
    }
  });

  app.addHook('onClose', async () => {
    stopHealthMonitor();
    stopProactiveMonitor();
    try {
      await prisma?.$disconnect();
    } catch (error) {
      app.log.warn({ err: error }, 'Failed to disconnect Prisma client');
    }
    redis?.disconnect();
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    app.log.error({ err: error, req: request }, 'Request error');

    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message;

    return reply.status(statusCode).send({
      error: {
        code: statusCode,
        message,
        ...(config.nodeEnv === 'development' && { stack: error.stack }),
      },
    });
  });

  return app;
}
