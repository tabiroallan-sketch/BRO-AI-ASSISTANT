import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const { fakeRedis, setTtl, calls } = vi.hoisted(() => {
  const state = new Map<string, { count: number; ttlMs: number }>();
  const calls: string[] = [];

  const fakeRedis = {
    async incr(key: string): Promise<number> {
      calls.push(`incr:${key}`);
      const entry = state.get(key) ?? { count: 0, ttlMs: 60_000 };
      entry.count += 1;
      state.set(key, entry);
      return entry.count;
    },
    async pexpire(key: string, ttlMs: number): Promise<number> {
      calls.push(`pexpire:${key}:${ttlMs}`);
      const entry = state.get(key);
      if (entry) {
        entry.ttlMs = ttlMs;
      }
      return 1;
    },
    async pttl(key: string): Promise<number> {
      calls.push(`pttl:${key}`);
      return state.get(key)?.ttlMs ?? 60_000;
    },
  };

  return {
    fakeRedis,
    setTtl: (key: string, ttlMs: number): void => {
      const entry = state.get(key) ?? { count: 0, ttlMs };
      entry.ttlMs = ttlMs;
      state.set(key, entry);
    },
    calls,
  };
});

vi.mock('../../src/lib/redis.js', () => ({ redis: fakeRedis }));

type RateLimitModule = typeof import('../../src/lib/rate-limit.js');

describe('regression: redis-backed rate limiter TTL correctness (Milestone 19 fix)', () => {
  let rateLimit: RateLimitModule;

  beforeAll(async () => {
    rateLimit = await import('../../src/lib/rate-limit.js');
  });

  function makeReply(): { headers: Record<string, string>; reply: FastifyReply } {
    const headers: Record<string, string> = {};
    const reply = {
      header: (name: string, value: string): void => {
        headers[name] = value;
      },
    } as unknown as FastifyReply;
    return { headers, reply };
  }

  it('uses the full window TTL for a fresh key', async () => {
    calls.length = 0;
    const limiter = rateLimit.createRateLimiter(5, 60_000);
    const { headers, reply } = makeReply();
    const start = Date.now();
    await limiter({ ip: 'redis-fresh' } as FastifyRequest, reply);

    expect(headers['RateLimit-Remaining']).toBe('4');
    expect(calls).toContain('pexpire:ratelimit:60000:5:redis-fresh:60000');
    const reset = Number(headers['RateLimit-Reset']);
    const expected = Math.ceil((start + 60_000) / 1000);
    expect(Math.abs(reset - expected)).toBeLessThanOrEqual(2);
  });

  it('reflects the remaining TTL instead of the full window on subsequent requests', async () => {
    calls.length = 0;
    const limiter = rateLimit.createRateLimiter(5, 60_000);
    const start = Date.now();

    const first = makeReply();
    await limiter({ ip: 'redis-ttl' } as FastifyRequest, first.reply);

    const second = makeReply();
    await limiter({ ip: 'redis-ttl' } as FastifyRequest, second.reply);

    expect(calls.some((call) => call.startsWith('pttl:'))).toBe(true);
    const reset = Number(second.headers['RateLimit-Reset']);
    const elapsed = Date.now() - start;
    const expected = Math.ceil((start + 60_000 - elapsed) / 1000);
    expect(Math.abs(reset - expected)).toBeLessThanOrEqual(2);
  });

  it('honors a shortened remaining TTL reported by redis', async () => {
    calls.length = 0;
    const limiter = rateLimit.createRateLimiter(5, 60_000);
    const ip = 'redis-short';
    const key = `ratelimit:60000:5:${ip}`;

    await limiter({ ip } as FastifyRequest, makeReply().reply);
    setTtl(key, 5000);

    const { headers, reply } = makeReply();
    const before = Date.now();
    await limiter({ ip } as FastifyRequest, reply);

    const reset = Number(headers['RateLimit-Reset']);
    const expected = Math.ceil((before + 5000) / 1000);
    expect(Math.abs(reset - expected)).toBeLessThanOrEqual(2);
  });

  it('falls back to in-memory tracking when redis throws', async () => {
    calls.length = 0;
    const { redis: liveRedis } = await import('../../src/lib/redis.js');
    const originalIncr = liveRedis.incr;
    (liveRedis as { incr: () => Promise<number> }).incr = async () => {
      throw new Error('connection refused');
    };

    try {
      const limiter = rateLimit.createRateLimiter(2, 60_000);
      const ip = 'redis-down';
      const { headers, reply } = makeReply();
      await limiter({ ip } as FastifyRequest, reply);

      expect(headers['RateLimit-Limit']).toBe('2');
      expect(headers['RateLimit-Remaining']).toBe('1');
      expect(headers['RateLimit-Reset']).toBeDefined();
    } finally {
      (liveRedis as { incr: () => Promise<number> }).incr = originalIncr;
    }
  });
});
