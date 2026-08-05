import { describe, expect, it } from 'vitest';
import type { LLMProvider, LLMStreamEvent } from '../../src/llm/index.js';
import {
  ModelManager,
  ProviderRegistry,
  modelManager,
  providerRegistry,
} from '../../src/llm/index.js';

function fakeProvider(id: string, defaultModel: string, catalog: string[]): LLMProvider {
  return {
    descriptor: {
      id,
      label: id,
      description: `fake provider ${id}`,
      requiresApiKey: false,
      envVar: `FAKE_${id.toUpperCase()}_KEY`,
      defaultModel,
    },
    initialize: async () => undefined,
    testConnection: async () => ({
      ok: true,
      status: 'connected',
      message: 'ok',
    }),
    listModels: async () => catalog.map((model) => ({ id: model })),
    streamChat: async function* (): AsyncGenerator<LLMStreamEvent> {
      yield { type: 'content', content: 'hi' };
    },
    completeChat: async () => ({ content: 'hi', toolCalls: [] }),
    getUsage: () => null,
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

function makeManager(): { manager: ModelManager; registry: ProviderRegistry } {
  const registry = new ProviderRegistry();
  registry.register(fakeProvider('acme', 'acme-default', ['acme-default', 'acme-pro']));
  registry.register(fakeProvider('other', 'other-default', ['other-default']));
  return { manager: new ModelManager(registry), registry };
}

describe('ModelManager', () => {
  it('resolves the explicit request model first', async () => {
    const { manager } = makeManager();
    await expect(manager.resolveModel('acme', 'acme-pro')).resolves.toBe('acme-pro');
  });

  it('resolves a user override before settings and default', async () => {
    const { manager } = makeManager();
    manager.setModel('acme', 'acme-pro');
    await expect(manager.resolveModel('acme', undefined, { model: 'acme-default' })).resolves.toBe(
      'acme-pro',
    );
  });

  it('resolves the settings model before the default', async () => {
    const { manager } = makeManager();
    await expect(manager.resolveModel('acme', undefined, { model: 'acme-pro' })).resolves.toBe(
      'acme-pro',
    );
  });

  it('resolves the provider default model when nothing else is set', async () => {
    const { manager } = makeManager();
    await expect(manager.resolveModel('acme')).resolves.toBe('acme-default');
    await expect(manager.resolveModel('other')).resolves.toBe('other-default');
  });

  it('trims whitespace from candidate models', async () => {
    const { manager } = makeManager();
    await expect(manager.resolveModel('acme', '  acme-pro  ')).resolves.toBe('acme-pro');
  });

  it('throws a not_configured LLMError when no model can be resolved', async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider('acme', '', []));
    const manager = new ModelManager(registry);
    await expect(manager.resolveModel('acme')).rejects.toMatchObject({
      code: 'not_configured',
      providerId: 'acme',
    });
  });

  it('throws a not_configured LLMError for an unknown provider', async () => {
    const { manager } = makeManager();
    await expect(manager.resolveModel('missing')).rejects.toMatchObject({
      code: 'not_configured',
    });
    await expect(manager.listModels('missing')).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('stores, reads and clears overrides', () => {
    const { manager } = makeManager();
    expect(manager.getModel('acme')).toBeUndefined();
    manager.setModel('acme', 'acme-pro');
    expect(manager.getModel('acme')).toBe('acme-pro');
    manager.clearModel('acme');
    expect(manager.getModel('acme')).toBeUndefined();
  });

  it('returns the provider default model', () => {
    const { manager } = makeManager();
    expect(manager.getDefaultModel('acme')).toBe('acme-default');
  });

  it('lists models and caches the catalog per provider', async () => {
    let calls = 0;
    const registry = new ProviderRegistry();
    registry.register({
      ...fakeProvider('acme', 'acme-default', ['acme-default']),
      listModels: async () => {
        calls += 1;
        return [{ id: 'acme-default' }];
      },
    });
    const manager = new ModelManager(registry);
    const first = await manager.listModels('acme');
    const second = await manager.listModels('acme');
    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it('checks whether a model id is in the catalog', async () => {
    const { manager } = makeManager();
    await expect(manager.isKnownModel('acme', 'acme-pro')).resolves.toBe(true);
    await expect(manager.isKnownModel('acme', 'nope')).resolves.toBe(false);
  });

  it('exposes a singleton wired to the provider registry', async () => {
    expect(modelManager).toBeInstanceOf(ModelManager);
    await expect(modelManager.resolveModel('nvidia')).resolves.toBe(
      providerRegistry.resolveDefault().descriptor.defaultModel,
    );
  });
});
