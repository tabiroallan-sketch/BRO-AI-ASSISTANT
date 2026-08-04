import { describe, expect, it, beforeEach } from 'vitest';
import { cacheClear, cacheDelete, cacheGet, cacheSet } from '../../src/lib/cache.js';

describe('cache under concurrent load', () => {
  beforeEach(() => {
    cacheClear();
  });

  it('survives 10 concurrent workers writing and reading', async () => {
    const workers = 10;
    const opsPerWorker = 2000;

    await Promise.all(
      Array.from({ length: workers }, (_, worker) =>
        (async () => {
          for (let index = 0; index < opsPerWorker; index += 1) {
            const key = `worker-${worker}-key-${index}`;
            cacheSet(key, { worker, index }, 60_000);
            cacheGet(key);
            if (index % 100 === 0) {
              cacheDelete(`worker-${worker}-key-${index - 100}`);
            }
          }
        })(),
      ),
    );

    const surviving = cacheGet<{ worker: number; index: number }>(
      `worker-9-key-${opsPerWorker - 1}`,
    );
    expect(surviving).toEqual({ worker: 9, index: opsPerWorker - 1 });
  });

  it('never throws under mixed TTL churn', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, worker) =>
        (async () => {
          for (let index = 0; index < 1000; index += 1) {
            cacheSet(`churn-${worker}-${index}`, index, index % 2 === 0 ? 1 : 60_000);
            cacheGet(`churn-${worker}-${index}`);
          }
        })(),
      ),
    );
    expect(true).toBe(true);
  });
});
