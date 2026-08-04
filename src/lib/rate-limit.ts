import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { redis } from './redis.js';

export type RateLimitConfig = {
  max?: number;
  windowMs?: number;
};

export class RateLimitExceededError extends Error {
  statusCode = 429;

  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests');
    this.name = 'RateLimitExceededError';
  }
}

type WindowEntry = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, WindowEntry>();
const limiterCache = new Map<
  string,
  (request: FastifyRequest, reply: FastifyReply) => Promise<void>
>();

function pruneExpired(now: number): void {
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) {
      windows.delete(key);
    }
  }
}

function inMemoryIncrement(key: string, windowMs: number): { count: number; resetAt: number } {
  const now = Date.now();
  if (windows.size > 10000) {
    pruneExpired(now);
  }
  const existing = windows.get(key);
  if (existing && existing.resetAt > now) {
    existing.count += 1;
    return existing;
  }
  const entry: WindowEntry = { count: 1, resetAt: now + windowMs };
  windows.set(key, entry);
  return entry;
}

async function redisIncrement(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  if (!redis) {
    return { count: 0, ttlMs: windowMs };
  }
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, windowMs);
    return { count, ttlMs: windowMs };
  }
  const ttlMs = await redis.pttl(key).catch(() => windowMs);
  return { count, ttlMs: ttlMs > 0 ? ttlMs : windowMs };
}

export function createRateLimiter(
  max: number,
  windowMs: number,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const cacheKey = `${max}:${windowMs}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = request.ip || 'unknown';
    const cacheId = `ratelimit:${windowMs}:${max}:${ip}`;

    let count: number;
    let resetAt: number;
    if (redis) {
      try {
        const incremented = await redisIncrement(cacheId, windowMs);
        count = incremented.count;
        resetAt = Date.now() + incremented.ttlMs;
      } catch {
        const entry = inMemoryIncrement(cacheId, windowMs);
        count = entry.count;
        resetAt = entry.resetAt;
      }
    } else {
      const entry = inMemoryIncrement(cacheId, windowMs);
      count = entry.count;
      resetAt = entry.resetAt;
    }

    const remaining = Math.max(0, max - count);
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    reply.header('RateLimit-Limit', String(max));
    reply.header('RateLimit-Remaining', String(remaining));
    reply.header('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > max) {
      reply.header('Retry-After', String(retryAfterSeconds));
      throw new RateLimitExceededError(retryAfterSeconds);
    }
  };

  limiterCache.set(cacheKey, handler);
  return handler;
}

export function applyRateLimits(app: FastifyInstance): void {
  if (!config.rateLimitEnabled) {
    return;
  }
  app.addHook('onRequest', async (request, reply) => {
    const routeConfig = request.routeOptions.config.rateLimit as RateLimitConfig | undefined;
    const max = routeConfig?.max ?? config.rateLimitMax;
    const windowMs = routeConfig?.windowMs ?? config.rateLimitWindowMs;
    await createRateLimiter(max, windowMs)(request, reply);
  });
}
