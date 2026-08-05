import type { LLMProvider } from '../interfaces/provider.js';
import type { ProviderRegistry } from '../registry/index.js';
import type { LLMModelInfo, ProviderSettings } from '../types/index.js';
import { LLMError } from '../utils/errors.js';
import { providerRegistry } from '../registry/index.js';

/**
 * Resolves and inspects models per provider. It is the single source of truth
 * for "which model should provider X use": an explicit request model wins,
 * then a user override (e.g. chosen in settings), then provider settings,
 * then the provider's default model.
 */
export class ModelManager {
  private readonly registry: ProviderRegistry;
  private readonly overrides = new Map<string, string>();
  private readonly modelCache = new Map<string, Promise<LLMModelInfo[]>>();

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  setModel(providerId: string, modelId: string): void {
    this.overrides.set(providerId, modelId);
  }

  getModel(providerId: string): string | undefined {
    return this.overrides.get(providerId);
  }

  clearModel(providerId: string): void {
    this.overrides.delete(providerId);
  }

  getDefaultModel(providerId: string): string | undefined {
    return this.getProvider(providerId).descriptor.defaultModel;
  }

  /** Lists the provider's catalog, caching per provider. */
  async listModels(providerId: string): Promise<LLMModelInfo[]> {
    const provider = this.getProvider(providerId);
    let promise = this.modelCache.get(providerId);
    if (!promise) {
      promise = provider.listModels();
      this.modelCache.set(providerId, promise);
    }
    return promise;
  }

  async isKnownModel(providerId: string, modelId: string): Promise<boolean> {
    const models = await this.listModels(providerId);
    return models.some((model) => model.id === modelId);
  }

  /**
   * Resolves the effective model id for a provider. Resolution order:
   * explicit request model -> user override -> provider settings -> default.
   */
  async resolveModel(
    providerId: string,
    requestedModel?: string,
    settings?: ProviderSettings,
  ): Promise<string> {
    const provider = this.getProvider(providerId);
    const candidate =
      requestedModel?.trim() ||
      this.overrides.get(providerId)?.trim() ||
      settings?.model?.trim() ||
      provider.descriptor.defaultModel;
    if (!candidate) {
      throw new LLMError({
        code: 'not_configured',
        providerId,
        message: `No model selected for ${provider.descriptor.label}.`,
      });
    }
    return candidate;
  }

  private getProvider(providerId: string): LLMProvider {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new LLMError({
        code: 'not_configured',
        providerId,
        message: `Unknown LLM provider: ${providerId}.`,
      });
    }
    return provider;
  }
}

export const modelManager = new ModelManager(providerRegistry);
