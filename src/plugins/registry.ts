import type { BroPlugin, PluginState, RegisteredPlugin } from './types.js';

const plugins = new Map<string, RegisteredPlugin>();

export function registerPlugin(
  name: string,
  manifest: BroPlugin,
  basePath: string,
  tools: string[],
): void {
  plugins.set(name, {
    manifest,
    basePath,
    tools,
    state: 'loaded',
    loadedAt: new Date().toISOString(),
  });
}

export function markPluginError(name: string, error: string): void {
  plugins.set(name, {
    ...(plugins.get(name) ?? {
      manifest: { name, version: '' },
      basePath: '',
      tools: [],
      loadedAt: new Date().toISOString(),
    }),
    state: 'error' as PluginState,
    error,
  });
}

export function unregisterPlugin(name: string): boolean {
  return plugins.delete(name);
}

export function getPlugin(name: string): RegisteredPlugin | undefined {
  return plugins.get(name);
}

export function listPlugins(): RegisteredPlugin[] {
  return [...plugins.values()];
}

export function clearPlugins(): void {
  plugins.clear();
}
