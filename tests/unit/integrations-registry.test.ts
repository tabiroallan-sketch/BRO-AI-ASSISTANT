import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProviders,
  getProvider,
  hasProvider,
  listProviders,
  registerProvider,
  unregisterProvider,
} from '../../src/integrations/registry.js';
import type { WebhookProviderDef } from '../../src/integrations/types.js';

const makeProvider = (id: string): WebhookProviderDef => ({
  id,
  label: `Provider ${id}`,
  description: `Description for ${id}`,
  type: 'webhook',
  icon: 'external',
  oauthConfigured: true,
  capabilities: ['test:read'],
  permissions: [],
});

describe('integration registry', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('registers and retrieves providers by id', () => {
    registerProvider(makeProvider('alpha'));
    expect(getProvider('alpha')).toBeDefined();
    expect(getProvider('missing')).toBeUndefined();
  });

  it('lists registered providers', () => {
    registerProvider(makeProvider('alpha'));
    registerProvider(makeProvider('beta'));
    expect(
      listProviders()
        .map((provider) => provider.id)
        .sort(),
    ).toEqual(['alpha', 'beta']);
  });

  it('refuses to overwrite a provider with the same id', () => {
    registerProvider(makeProvider('alpha'));
    const replaced = registerProvider({ ...makeProvider('alpha'), label: 'Replacement' });
    expect(replaced).toBe(false);
    expect(listProviders().filter((provider) => provider.id === 'alpha')).toHaveLength(1);
    expect(getProvider('alpha')?.label).toBe('Provider alpha');
  });

  it('reports hasProvider correctly', () => {
    registerProvider(makeProvider('alpha'));
    expect(hasProvider('alpha')).toBe(true);
    expect(hasProvider('missing')).toBe(false);
  });

  it('unregisters providers and reports success', () => {
    registerProvider(makeProvider('alpha'));
    expect(unregisterProvider('alpha')).toBe(true);
    expect(getProvider('alpha')).toBeUndefined();
    expect(unregisterProvider('alpha')).toBe(false);
  });

  it('clears all providers', () => {
    registerProvider(makeProvider('alpha'));
    registerProvider(makeProvider('beta'));
    clearProviders();
    expect(listProviders()).toEqual([]);
  });
});
