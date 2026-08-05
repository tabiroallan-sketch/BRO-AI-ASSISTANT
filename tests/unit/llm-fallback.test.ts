import { describe, expect, it } from 'vitest';
import type { LLMProvider, LLMStreamEvent } from '../../src/llm/index.js';
import { LLMError, ProviderFallback, ProviderRegistry } from '../../src/llm/index.js';

function fakeProvider(id: string, failWith?: unknown): LLMProvider {
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
    completeChat: async (): Promise<{ content: string; toolCalls: [] }> => {
      if (failWith !== undefined) {
        throw failWith;
      }
      return { content: 'ok', toolCalls: [] };
    },
    getUsage: () => null,
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

async function run(provider: LLMProvider): Promise<string> {
  await provider.completeChat({ messages: [] });
  return provider.descriptor.id;
}

describe('ProviderFallback', () => {
  it('returns the result of the first successful provider', async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider('primary'));
    registry.register(fakeProvider('secondary'));
    const fallback = new ProviderFallback(registry);
    await expect(fallback.execute(run)).resolves.toBe('primary');
  });

  it('fails over to the next provider in order', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider(
        'primary',
        new LLMError({ code: 'auth_failed', providerId: 'primary', message: 'bad key' }),
      ),
    );
    registry.register(fakeProvider('secondary'));
    const fallback = new ProviderFallback(registry);
    await expect(fallback.execute(run)).resolves.toBe('secondary');
  });

  it('skips unregistered ids in the preferred order', async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider('secondary'));
    const fallback = new ProviderFallback(registry, { order: ['missing', 'secondary'] });
    await expect(fallback.execute(run)).resolves.toBe('secondary');
  });

  it('tries the preferred order before remaining providers', async () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider('primary'));
    registry.register(fakeProvider('secondary'));
    const fallback = new ProviderFallback(registry, { order: ['secondary', 'primary'] });
    await expect(fallback.execute(run)).resolves.toBe('secondary');
  });

  it('rethrows the sole failure when only one provider is tried', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider(
        'only',
        new LLMError({ code: 'rate_limited', providerId: 'only', message: 'throttled' }),
      ),
    );
    const fallback = new ProviderFallback(registry);
    await expect(fallback.execute(run)).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'throttled',
    });
  });

  it('throws an aggregate error when all providers fail', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider('a', new LLMError({ code: 'network', providerId: 'a', message: 'a down' })),
    );
    registry.register(
      fakeProvider(
        'b',
        new LLMError({ code: 'auth_failed', providerId: 'b', message: 'b bad key' }),
      ),
    );
    const fallback = new ProviderFallback(registry);
    await expect(fallback.execute(run)).rejects.toMatchObject({
      code: 'unknown',
      message: expect.stringContaining('a: a down'),
    });
    await expect(fallback.execute(run)).rejects.toMatchObject({
      message: expect.stringContaining('b: b bad key'),
    });
  });

  it('does not fall back on a cancelled request', async () => {
    let called = 0;
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider('a', new LLMError({ code: 'cancelled', providerId: 'a', message: 'cancelled' })),
    );
    registry.register({
      ...fakeProvider('b'),
      completeChat: async () => {
        called += 1;
        return { content: 'should not run', toolCalls: [] };
      },
    });
    const fallback = new ProviderFallback(registry);
    await expect(fallback.execute(run)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(called).toBe(0);
  });

  it('tries only the first provider when disabled', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider('a', new LLMError({ code: 'network', providerId: 'a', message: 'a down' })),
    );
    registry.register(fakeProvider('b'));
    const fallback = new ProviderFallback(registry, { enabled: false });
    await expect(fallback.execute(run)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('throws not_configured when no providers are registered', async () => {
    const fallback = new ProviderFallback(new ProviderRegistry());
    await expect(fallback.execute(run)).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});
