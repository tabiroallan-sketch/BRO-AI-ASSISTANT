import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { appRoutes } from './routes/index.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    trustProxy: true,
  });

  app.register(helmet);

  app.register(cookie);

  app.register(cors, {
    origin: config.corsOrigin,
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

  app.addHook('onClose', async () => {
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
