import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

process.env.REDIS_URL = '';

type RateLimitModule = typeof import('../../src/lib/rate-limit.js');

describe('in-memory rate limiter', () => {
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

  it('counts a first request as 1 with remaining budget', async () => {
    const limiter = rateLimit.createRateLimiter(5, 60_000);
    const { headers, reply } = makeReply();
    await limiter({ ip: '10.0.0.1' } as FastifyRequest, reply);
    expect(headers['RateLimit-Limit']).toBe('5');
    expect(headers['RateLimit-Remaining']).toBe('4');
  });

  it('throws RateLimitExceededError once the limit is passed', async () => {
    const limiter = rateLimit.createRateLimiter(2, 60_000);
    const ip = '10.0.0.2';
    await limiter({ ip } as FastifyRequest, makeReply().reply);
    await limiter({ ip } as FastifyRequest, makeReply().reply);
    const { headers, reply } = makeReply();
    await expect(limiter({ ip } as FastifyRequest, reply)).rejects.toThrow('Too many requests');
    expect(headers['Retry-After']).toBeDefined();
    expect(Number(headers['RateLimit-Remaining'])).toBe(0);
  });

  it('tracks distinct IPs independently', async () => {
    const limiter = rateLimit.createRateLimiter(1, 60_000);
    await limiter({ ip: '10.0.0.3' } as FastifyRequest, makeReply().reply);
    await expect(
      limiter({ ip: '10.0.0.4' } as FastifyRequest, makeReply().reply),
    ).resolves.toBeUndefined();
  });

  it('resets the window after it expires', async () => {
    const limiter = rateLimit.createRateLimiter(1, 60);
    const ip = '10.0.0.5';
    await limiter({ ip } as FastifyRequest, makeReply().reply);
    await expect(limiter({ ip } as FastifyRequest, makeReply().reply)).rejects.toThrow(
      'Too many requests',
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(limiter({ ip } as FastifyRequest, makeReply().reply)).resolves.toBeUndefined();
  });

  it('reuses a cached limiter for identical parameters', () => {
    const first = rateLimit.createRateLimiter(10, 30_000);
    const second = rateLimit.createRateLimiter(10, 30_000);
    expect(second).toBe(first);
  });
});
