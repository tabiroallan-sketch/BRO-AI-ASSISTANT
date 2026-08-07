import { describe, expect, it } from 'vitest';
import { createDedupeStore } from '../../src/proactive/dedupe.js';

describe('createDedupeStore', () => {
  it('records one-shot keys once', () => {
    const store = createDedupeStore();
    const now = new Date('2026-08-07T10:00:00Z');
    expect(store.rememberOnce('u1', 'email:1', now)).toBe(false);
    expect(store.rememberOnce('u1', 'email:1', now)).toBe(true);
    expect(store.rememberOnce('u2', 'email:1', now)).toBe(false);
    expect(store.rememberOnce('u1', 'email:2', now)).toBe(false);
  });

  it('enforces the cooldown window for stateful keys', () => {
    const store = createDedupeStore();
    const first = new Date('2026-08-07T10:00:00Z');
    expect(store.inCooldown('u1', 'build:m1', 60_000, first)).toBe(false);
    expect(store.inCooldown('u1', 'build:m1', 60_000, new Date('2026-08-07T10:00:30Z'))).toBe(true);
    expect(store.inCooldown('u1', 'build:m1', 60_000, new Date('2026-08-07T10:01:01Z'))).toBe(
      false,
    );
  });

  it('is scoped per user', () => {
    const store = createDedupeStore();
    const now = new Date('2026-08-07T10:00:00Z');
    expect(store.inCooldown('u1', 'cpu', 60_000, now)).toBe(false);
    expect(store.inCooldown('u2', 'cpu', 60_000, now)).toBe(false);
  });

  it('prunes stale entries', () => {
    const store = createDedupeStore();
    store.rememberOnce('u1', 'email:old', new Date('2026-07-01T00:00:00Z'));
    store.inCooldown('u1', 'cpu', 60_000, new Date('2026-07-01T00:00:00Z'));
    store.prune(30 * 24 * 60 * 60 * 1000, new Date('2026-08-07T00:00:00Z'));

    expect(store.rememberOnce('u1', 'email:old', new Date('2026-08-07T00:00:01Z'))).toBe(false);
    expect(store.inCooldown('u1', 'cpu', 60_000, new Date('2026-08-07T00:00:01Z'))).toBe(false);
  });

  it('clears all state', () => {
    const store = createDedupeStore();
    store.rememberOnce('u1', 'email:1', new Date());
    store.clear();
    expect(store.rememberOnce('u1', 'email:1', new Date())).toBe(false);
  });
});
