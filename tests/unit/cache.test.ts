import { beforeEach, describe, expect, it } from 'vitest';
import { cacheClear, cacheDelete, cacheGet, cacheSet } from '../../src/lib/cache.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('in-memory TTL cache', () => {
  beforeEach(() => {
    cacheClear();
  });

  it('returns undefined for a missing key', () => {
    expect(cacheGet('missing')).toBeUndefined();
  });

  it('stores and returns values', () => {
    cacheSet('key', { hello: 'world' }, 1000);
    expect(cacheGet<{ hello: string }>('key')).toEqual({ hello: 'world' });
  });

  it('expires entries after their TTL', async () => {
    cacheSet('key', 'value', 20);
    expect(cacheGet('key')).toBe('value');
    await sleep(40);
    expect(cacheGet('key')).toBeUndefined();
  });

  it('does not store entries with a non-positive TTL', () => {
    cacheSet('key', 'value', 0);
    cacheSet('key2', 'value', -5);
    expect(cacheGet('key')).toBeUndefined();
    expect(cacheGet('key2')).toBeUndefined();
  });

  it('overwrites an existing key and refreshes its TTL', async () => {
    cacheSet('key', 'first', 1000);
    cacheSet('key', 'second', 1000);
    expect(cacheGet('key')).toBe('second');
    cacheSet('key', 'short-lived', 20);
    await sleep(40);
    expect(cacheGet('key')).toBeUndefined();
  });

  it('supports per-key deletion', () => {
    cacheSet('key', 'value', 1000);
    cacheDelete('key');
    expect(cacheGet('key')).toBeUndefined();
  });

  it('clears all entries', () => {
    cacheSet('a', 1, 1000);
    cacheSet('b', 2, 1000);
    cacheClear();
    expect(cacheGet('a')).toBeUndefined();
    expect(cacheGet('b')).toBeUndefined();
  });

  it('bounds the store size and evicts the oldest entry when full', () => {
    const capacity = 5000;
    for (let index = 0; index < capacity + 10; index += 1) {
      cacheSet(`bulk-${index}`, index, 60_000);
    }
    expect(cacheGet('bulk-0')).toBeUndefined();
    expect(cacheGet(`bulk-${capacity + 9}`)).toBe(capacity + 9);
  });
});
