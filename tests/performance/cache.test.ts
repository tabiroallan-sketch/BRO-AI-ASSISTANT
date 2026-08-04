import { describe, expect, it, beforeEach } from 'vitest';
import { cacheClear, cacheGet, cacheSet } from '../../src/lib/cache.js';

describe('cache throughput', () => {
  beforeEach(() => {
    cacheClear();
  });

  it('handles 50k writes and 50k reads quickly', { retry: 2 }, () => {
    const count = 50_000;
    const start = performance.now();
    for (let index = 0; index < count; index += 1) {
      cacheSet(`key-${index}`, index, 1);
    }
    for (let index = 0; index < count; index += 1) {
      cacheGet(`key-${index}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('performs 50k cache misses quickly', { retry: 2 }, () => {
    const count = 50_000;
    const start = performance.now();
    for (let index = 0; index < count; index += 1) {
      cacheGet(`missing-${index}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });
});
