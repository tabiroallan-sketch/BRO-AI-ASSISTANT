import type { AuthUser } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }

  interface FastifyContextConfig {
    rateLimit?: { max: number; windowMs: number };
  }
}

export {};
