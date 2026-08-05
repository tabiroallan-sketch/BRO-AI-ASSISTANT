import { prisma } from '../../lib/prisma.js';
import { decryptSecret, encryptSecret } from '../../lib/llm-config-crypto.js';
import { clearSecret, registerSecret } from '../../lib/secrets.js';
import { modelManager } from '../model-manager/index.js';
import { providerRegistry } from '../registry/index.js';
import type { ProviderConnectionResult } from '../types/index.js';

const CONFIG_ID = 'global';

export type AiConfigRow = {
  id: string;
  providerId: string | null;
  model: string | null;
  apiKey: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  lastLatencyMs: number | null;
  lastTestedAt: Date | null;
};

export type AiConfigDb = {
  aiConfig: {
    findUnique: (args: { where: { id: string } }) => Promise<AiConfigRow | null>;
    upsert: (args: {
      where: { id: string };
      create: Partial<AiConfigRow>;
      update: Partial<AiConfigRow>;
    }) => Promise<AiConfigRow>;
    update: (args: { where: { id: string }; data: Partial<AiConfigRow> }) => Promise<AiConfigRow>;
  };
};

const EMPTY_ROW: AiConfigRow = {
  id: CONFIG_ID,
  providerId: null,
  model: null,
  apiKey: null,
  lastStatus: null,
  lastMessage: null,
  lastLatencyMs: null,
  lastTestedAt: null,
};

function sanitize(row: AiConfigRow): AiConfigRow {
  return { ...EMPTY_ROW, ...row, id: CONFIG_ID };
}

/**
 * Persistent, global AI provider configuration (active provider, active model,
 * and an encrypted API key). Saved settings survive restarts and are loaded
 * into the runtime secret registry at startup so chat and the provider layer
 * pick them up transparently.
 */
export class AiConfigStore {
  private readonly db: AiConfigDb | null;
  private cache: AiConfigRow | null = null;

  constructor(db: AiConfigDb | null = prisma as unknown as AiConfigDb | null) {
    this.db = db;
  }

  async get(): Promise<AiConfigRow> {
    if (this.cache) {
      return this.cache;
    }
    if (!this.db) {
      this.cache = { ...EMPTY_ROW };
      return this.cache;
    }
    const existing = await this.db.aiConfig.findUnique({ where: { id: CONFIG_ID } });
    if (existing) {
      this.cache = sanitize(existing);
      return this.cache;
    }
    const created = await this.db.aiConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
    this.cache = sanitize(created);
    return this.cache;
  }

  async save(input: {
    providerId?: string;
    model?: string;
    apiKey?: string;
  }): Promise<AiConfigRow> {
    const row = await this.get();
    const update: Partial<AiConfigRow> = {};

    const providerId = input.providerId?.trim() || row.providerId;
    if (providerId && providerId !== row.providerId) {
      update.providerId = providerId;
    }

    const model = input.model?.trim();
    if (model) {
      update.model = model;
      if (providerId) {
        modelManager.setModel(providerId, model);
      }
    }

    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      const target = providerId ?? row.providerId;
      if (!target) {
        throw new Error('A provider is required to save an API key.');
      }
      const provider = providerRegistry.get(target);
      if (!provider) {
        throw new Error(`Unknown LLM provider: ${target}.`);
      }
      update.apiKey = encryptSecret(apiKey);
      update.providerId = target;
      registerSecret(provider.descriptor.envVar, apiKey);
    }

    if (Object.keys(update).length === 0) {
      return row;
    }

    if (!this.db) {
      this.cache = { ...row, ...update };
      return this.cache;
    }
    const saved = await this.db.aiConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, ...update },
      update,
    });
    this.cache = sanitize(saved);
    return this.cache;
  }

  async clearApiKey(): Promise<AiConfigRow> {
    const row = await this.get();
    if (row.providerId) {
      const provider = providerRegistry.get(row.providerId);
      if (provider) {
        clearSecret(provider.descriptor.envVar);
      }
    }
    if (!row.apiKey) {
      return row;
    }
    if (!this.db) {
      this.cache = { ...row, apiKey: null };
      return this.cache;
    }
    const saved = await this.db.aiConfig.update({
      where: { id: CONFIG_ID },
      data: { apiKey: null },
    });
    this.cache = sanitize(saved);
    return this.cache;
  }

  async recordTestResult(result: ProviderConnectionResult): Promise<AiConfigRow> {
    const row = await this.get();
    const update: Partial<AiConfigRow> = {
      lastStatus: result.ok ? 'connected' : (result.status ?? 'error'),
      lastMessage: result.message,
      lastLatencyMs: result.latencyMs ?? null,
      lastTestedAt: new Date(),
    };
    if (!this.db) {
      this.cache = { ...row, ...update };
      return this.cache;
    }
    const saved = await this.db.aiConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, ...update },
      update,
    });
    this.cache = sanitize(saved);
    return this.cache;
  }

  /**
   * Applies persisted settings to the runtime: registers the saved API key in
   * the secret registry and restores the active model override. Called once at
   * startup before the server begins accepting requests.
   */
  async loadIntoRuntime(): Promise<void> {
    const row = await this.get();
    const provider = row.providerId ? providerRegistry.get(row.providerId) : undefined;
    if (provider && row.apiKey) {
      const key = decryptSecret(row.apiKey);
      if (key) {
        registerSecret(provider.descriptor.envVar, key);
      }
    }
    if (provider && row.model) {
      modelManager.setModel(row.providerId as string, row.model);
    }
  }
}

export const aiConfigStore = new AiConfigStore();
