import type { LLMProvider } from '../interfaces/provider.js';
import type { ProviderDescriptor } from '../types/index.js';
import { NvidiaProvider } from '../providers/nvidia/index.js';
import { GeminiProvider } from '../providers/gemini/index.js';

export const DEFAULT_PROVIDER_ID = 'nvidia';

/**
 * Registry of LLM providers available to the application. Providers register
 * themselves here by side-effect import (see bottom of this file), so any
 * module that imports the registry can enumerate or resolve providers.
 *
 * The class is constructible so tests can spin up an isolated registry;
 * production code should use the exported singleton or `getProviderRegistry()`.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    const id = provider.descriptor.id;
    if (this.providers.has(id)) {
      throw new Error(`LLM provider already registered: ${id}`);
    }
    this.providers.set(id, provider);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  listDescriptors(): ProviderDescriptor[] {
    return this.list().map((provider) => provider.descriptor);
  }

  getDefault(): LLMProvider | undefined {
    return this.providers.get(DEFAULT_PROVIDER_ID) ?? this.providers.values().next().value;
  }

  resolveDefault(desiredId?: string): LLMProvider {
    const provider = desiredId ? this.providers.get(desiredId) : undefined;
    const resolved = provider ?? this.getDefault();
    if (!resolved) {
      throw new Error('No LLM providers registered.');
    }
    return resolved;
  }
}

export const providerRegistry = new ProviderRegistry();

export function getProviderRegistry(): ProviderRegistry {
  return providerRegistry;
}

providerRegistry.register(new NvidiaProvider());
providerRegistry.register(new GeminiProvider());
