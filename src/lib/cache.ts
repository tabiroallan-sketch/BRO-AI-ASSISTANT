type CacheEntry = {
  value: unknown;
  expiresAt: number;
  insertedAt: number;
};

const MAX_ENTRIES = 5000;
const store = new Map<string, CacheEntry>();

function prune(now: number): void {
  if (store.size < MAX_ENTRIES) {
    return;
  }
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
  if (store.size < MAX_ENTRIES) {
    return;
  }
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, entry] of store) {
    if (entry.insertedAt < oldestAt) {
      oldestAt = entry.insertedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    store.delete(oldestKey);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (ttlMs <= 0) {
    return;
  }
  prune(Date.now());
  store.set(key, { value, expiresAt: Date.now() + ttlMs, insertedAt: Date.now() });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClear(): void {
  store.clear();
}
