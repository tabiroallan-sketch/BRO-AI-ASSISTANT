type CacheEntry = {
  value: unknown;
  expiresAt: number;
  insertedAt: number;
};

const MAX_ENTRIES = 5000;
const EVICT_BATCH = 64;
const store = new Map<string, CacheEntry>();

function evictOldest(batch: number): void {
  const smallest: Array<[string, number]> = [];
  for (const [key, entry] of store) {
    if (smallest.length < batch) {
      smallest.push([key, entry.insertedAt]);
      if (smallest.length === batch) {
        smallest.sort((a, b) => a[1] - b[1]);
      }
    } else if (entry.insertedAt < smallest[batch - 1]![1]) {
      smallest[batch - 1] = [key, entry.insertedAt];
      smallest.sort((a, b) => a[1] - b[1]);
    }
  }
  for (const [key] of smallest) {
    store.delete(key);
  }
}

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
  evictOldest(EVICT_BATCH);
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
