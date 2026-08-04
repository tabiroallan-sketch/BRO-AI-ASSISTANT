import type { Tool } from '../tools/types.js';

export interface PluginLog {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface PluginContext {
  basePath: string;
  log: PluginLog;
}

export interface BroPlugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  tools?: Tool[];
  setup?(context: PluginContext): void | Promise<void>;
  teardown?(context: PluginContext): void | Promise<void>;
}

export type PluginState = 'loaded' | 'error';

export interface RegisteredPlugin {
  manifest: BroPlugin;
  basePath: string;
  tools: string[];
  state: PluginState;
  error?: string;
  loadedAt: string;
}

export type PluginSummary = {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  state: PluginState;
  error?: string;
  tools: string[];
};

export type PluginLoadResult = {
  loaded: PluginSummary[];
  skipped: string[];
  failed: Array<{ file: string; error: string }>;
};
