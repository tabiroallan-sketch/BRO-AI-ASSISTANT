import { describe, expect, it } from 'vitest';
import { NvidiaProvider, NVIDIA_DEFAULT_MODEL, NVIDIA_MODELS } from '../../src/llm/index.js';

describe('NvidiaProvider', () => {
  it('exposes a correct provider descriptor', () => {
    const provider = new NvidiaProvider();
    expect(provider.descriptor.id).toBe('nvidia');
    expect(provider.descriptor.label).toBe('NVIDIA');
    expect(provider.descriptor.requiresApiKey).toBe(true);
    expect(provider.descriptor.envVar).toBe('NVIDIA_API_KEY');
    expect(provider.descriptor.defaultBaseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(provider.descriptor.defaultModel).toBe(NVIDIA_DEFAULT_MODEL);
  });

  it('lists a non-empty catalog of unique model ids', async () => {
    const provider = new NvidiaProvider();
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    const ids = new Set(models.map((model) => model.id));
    expect(ids.size).toBe(models.length);
    for (const model of models) {
      expect(model.id).toMatch(/^[a-z0-9.-]+\/[a-z0-9._-]+$/i);
      expect(model.capabilities).toBeTruthy();
    }
  });

  it('exposes the default model in the catalog', () => {
    expect(NVIDIA_MODELS.some((model) => model.id === NVIDIA_DEFAULT_MODEL)).toBe(true);
  });

  it('reports not configured without an API key', () => {
    const provider = new NvidiaProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.isConfigured({ apiKey: '  ' })).toBe(false);
    expect(provider.isConfigured({ apiKey: 'nvapi-abc' })).toBe(true);
  });

  it('reports disconnected when testing without a key', async () => {
    const provider = new NvidiaProvider();
    const result = await provider.testConnection({});
    expect(result.ok).toBe(false);
    expect(result.status).toBe('disconnected');
  });

  it('throws a not_configured LLMError when streaming with no model and no key', async () => {
    const provider = new NvidiaProvider();
    await expect(
      provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] }).next(),
    ).rejects.toMatchObject({
      code: 'not_configured',
      providerId: 'nvidia',
    });
  });
});
