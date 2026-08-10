import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecret } from '../../src/lib/secrets.js';
import { GEMINI_DEFAULT_MODEL, GEMINI_MODELS, GeminiProvider } from '../../src/llm/index.js';

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  clearSecret('OPENAI_API_KEY');
  process.env.OPENAI_API_KEY = '';
});

afterEach(() => {
  clearSecret('OPENAI_API_KEY');
  process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
});

describe('GeminiProvider', () => {
  it('exposes a correct provider descriptor', () => {
    const provider = new GeminiProvider();
    expect(provider.descriptor.id).toBe('gemini');
    expect(provider.descriptor.label).toBe('Gemini (OpenAI-compatible)');
    expect(provider.descriptor.requiresApiKey).toBe(true);
    expect(provider.descriptor.envVar).toBe('OPENAI_API_KEY');
    expect(provider.descriptor.defaultBaseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    expect(provider.descriptor.defaultModel).toBe(GEMINI_DEFAULT_MODEL);
  });

  it('lists a non-empty static catalog of unique model ids without a key', async () => {
    const provider = new GeminiProvider();
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    const ids = new Set(models.map((model) => model.id));
    expect(ids.size).toBe(models.length);
    for (const model of models) {
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/i);
      expect(model.capabilities).toBeTruthy();
    }
  });

  it('exposes the default model in the catalog', () => {
    expect(GEMINI_MODELS.some((model) => model.id === GEMINI_DEFAULT_MODEL)).toBe(true);
  });

  it('reports not configured without an API key', () => {
    const provider = new GeminiProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.isConfigured({ apiKey: '  ' })).toBe(false);
    expect(provider.isConfigured({ apiKey: 'AIza-abc' })).toBe(true);
  });

  it('reports disconnected when testing without a key', async () => {
    const provider = new GeminiProvider();
    const result = await provider.testConnection({});
    expect(result.ok).toBe(false);
    expect(result.status).toBe('disconnected');
  });
});
