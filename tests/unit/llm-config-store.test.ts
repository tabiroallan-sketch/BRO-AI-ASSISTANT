import { describe, expect, it } from 'vitest';
import {
  AiConfigStore,
  type AiConfigDb,
  type AiConfigRow,
} from '../../src/llm/config-store/index.js';
import { encryptSecret } from '../../src/lib/llm-config-crypto.js';
import { clearSecret, getSecret } from '../../src/lib/secrets.js';
import { modelManager } from '../../src/llm/index.js';

function fakeDb(seed?: AiConfigRow): AiConfigDb {
  let row: AiConfigRow | null = seed ?? null;
  return {
    aiConfig: {
      findUnique: async (): Promise<AiConfigRow | null> => row,
      upsert: async ({ where, create, update }): Promise<AiConfigRow> => {
        row = row
          ? { ...row, ...update, id: where.id }
          : {
              id: where.id,
              ...create,
              lastStatus: null,
              lastMessage: null,
              lastLatencyMs: null,
              lastTestedAt: null,
            };
        return row;
      },
      update: async ({ where, data }): Promise<AiConfigRow> => {
        if (!row) {
          throw new Error('no row to update');
        }
        row = { ...row, ...data, id: where.id };
        return row;
      },
    },
  };
}

describe('AiConfigStore', () => {
  it('returns an empty row when nothing is persisted', async () => {
    const store = new AiConfigStore(fakeDb());
    const row = await store.get();
    expect(row.providerId).toBeNull();
    expect(row.model).toBeNull();
    expect(row.apiKey).toBeNull();
  });

  it('works without a database (in-memory)', async () => {
    const store = new AiConfigStore(null);
    await expect(store.save({ providerId: 'nvidia', model: 'x' })).resolves.toMatchObject({
      providerId: 'nvidia',
      model: 'x',
    });
    expect((await store.get()).providerId).toBe('nvidia');
  });

  it('encrypts and registers a saved API key', async () => {
    clearSecret('NVIDIA_API_KEY');
    const store = new AiConfigStore(fakeDb());
    const row = await store.save({ providerId: 'nvidia', apiKey: 'sk-saved-987' });
    expect(row.apiKey).not.toBeNull();
    expect(row.apiKey).not.toContain('sk-saved-987');
    expect(getSecret('NVIDIA_API_KEY')).toBe('sk-saved-987');
    clearSecret('NVIDIA_API_KEY');
  });

  it('clears a saved API key and unregisters it', async () => {
    clearSecret('NVIDIA_API_KEY');
    const store = new AiConfigStore(fakeDb());
    await store.save({ providerId: 'nvidia', apiKey: 'sk-saved-987' });
    const row = await store.clearApiKey();
    expect(row.apiKey).toBeNull();
    clearSecret('NVIDIA_API_KEY');
  });

  it('persists the active model', async () => {
    const store = new AiConfigStore(fakeDb());
    const row = await store.save({ providerId: 'nvidia', model: 'meta/llama-4' });
    expect(row.model).toBe('meta/llama-4');
  });

  it('records the last test result', async () => {
    const before = new Date();
    const store = new AiConfigStore(fakeDb());
    const row = await store.recordTestResult({
      ok: true,
      status: 'connected',
      message: 'Connected to NVIDIA',
      latencyMs: 120,
    });
    expect(row.lastStatus).toBe('connected');
    expect(row.lastMessage).toBe('Connected to NVIDIA');
    expect(row.lastLatencyMs).toBe(120);
    expect(row.lastTestedAt).not.toBeNull();
    expect((row.lastTestedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('stores failure status for failed tests', async () => {
    const store = new AiConfigStore(fakeDb());
    const row = await store.recordTestResult({
      ok: false,
      status: 'auth_failed',
      message: 'Invalid API key',
    });
    expect(row.lastStatus).toBe('auth_failed');
    expect(row.lastMessage).toBe('Invalid API key');
  });

  it('loads the saved key and model into the runtime', async () => {
    clearSecret('NVIDIA_API_KEY');
    const seed: AiConfigRow = {
      id: 'global',
      providerId: 'nvidia',
      model: 'meta/llama-4',
      apiKey: encryptSecret('sk-loaded-42'),
      lastStatus: null,
      lastMessage: null,
      lastLatencyMs: null,
      lastTestedAt: null,
    };
    const store = new AiConfigStore(fakeDb(seed));
    await store.loadIntoRuntime();
    expect(getSecret('NVIDIA_API_KEY')).toBe('sk-loaded-42');
    expect(modelManager.getModel('nvidia')).toBe('meta/llama-4');
    clearSecret('NVIDIA_API_KEY');
    modelManager.clearModel('nvidia');
  });

  it('requires a provider to save an API key', async () => {
    const store = new AiConfigStore(fakeDb());
    await expect(store.save({ apiKey: 'sk-nope' })).rejects.toThrow('A provider is required');
  });
});
