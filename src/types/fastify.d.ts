import type { AuthUser } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export {};
