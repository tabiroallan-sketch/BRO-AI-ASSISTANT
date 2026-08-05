import { describe, expect, it } from 'vitest';
import type { LLMProvider, LLMStreamEvent } from '../../src/llm/index.js';
import { DEFAULT_PROVIDER_ID, ProviderRegistry, providerRegistry } from '../../src/llm/index.js';

function fakeProvider(id: string): LLMProvider {
  return {
    descriptor: {
      id,
      label: id,
      description: `fake provider ${id}`,
      requiresApiKey: false,
      envVar: `FAKE_${id.toUpperCase()}_KEY`,
      defaultModel: 'fake-model',
    },
    initialize: async () => undefined,
    testConnection: async () => ({
      ok: true,
      status: 'connected',
      message: 'ok',
    }),
    listModels: async () => [{ id: 'fake-model' }],
    streamChat: async function* (): AsyncGenerator<LLMStreamEvent> {
      yield { type: 'content', content: 'hi' };
    },
    completeChat: async () => ({ content: 'hi', toolCalls: [] }),
    getUsage: () => null,
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves providers by id', () => {
    const registry = new ProviderRegistry();
    const provider = fakeProvider('acme');
    registry.register(provider);
    expect(registry.get('acme')).toBe(provider);
    expect(registry.has('acme')).toBe(true);
  });

  it('throws when a provider id is registered twice', () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider('acme'));
    expect(() => registry.register(fakeProvider('acme'))).toThrow(/already registered/);
  });

  it('lists providers and descriptors in registration order', () => {
    const registry = new ProviderRegistry();
    const first = fakeProvider('first');
    const second = fakeProvider('second');
    registry.register(first);
    registry.register(second);
    expect(registry.list()).toEqual([first, second]);
    expect(registry.listDescriptors().map((descriptor) => descriptor.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('resolves the default provider', () => {
    const registry = new ProviderRegistry();
    const nvidia = fakeProvider(DEFAULT_PROVIDER_ID);
    registry.register(nvidia);
    registry.register(fakeProvider('other'));
    expect(registry.getDefault()).toBe(nvidia);
    expect(registry.resolveDefault()).toBe(nvidia);
    expect(registry.resolveDefault('other').descriptor.id).toBe('other');
  });

  it('falls back to the first provider when the default id is absent', () => {
    const registry = new ProviderRegistry();
    const only = fakeProvider('only');
    registry.register(only);
    expect(registry.getDefault()).toBe(only);
    expect(registry.resolveDefault()).toBe(only);
  });

  it('throws when resolving with an empty registry', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.resolveDefault()).toThrow(/no LLM providers/i);
    expect(() => registry.resolveDefault('missing')).toThrow(/no LLM providers/i);
  });

  it('exposes a singleton pre-registered with NVIDIA', () => {
    expect(providerRegistry).toBeInstanceOf(ProviderRegistry);
    expect(providerRegistry.has(DEFAULT_PROVIDER_ID)).toBe(true);
    expect(providerRegistry.resolveDefault().descriptor.id).toBe(DEFAULT_PROVIDER_ID);
  });
});
