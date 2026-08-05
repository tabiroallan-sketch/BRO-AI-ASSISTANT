import type { ProviderDef } from './types.js';

const providers = new Map<string, ProviderDef>();

/**
 * Installs a provider definition. Returns false (without overwriting) when a
 * provider with the same id is already installed.
 */
export function registerProvider(def: ProviderDef): boolean {
  if (providers.has(def.id)) {
    return false;
  }
  providers.set(def.id, def);
  return true;
}

export function unregisterProvider(id: string): boolean {
  return providers.delete(id);
}

export function getProvider(id: string): ProviderDef | undefined {
  return providers.get(id);
}

export function listProviders(): ProviderDef[] {
  return [...providers.values()];
}

export function hasProvider(id: string): boolean {
  return providers.has(id);
}

export function clearProviders(): void {
  providers.clear();
}
