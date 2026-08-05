import type { LLMUsage } from '../types/index.js';

export type ProviderLifecycleEvent =
  | { type: 'beforeRequest'; providerId: string; startedAt: number }
  | { type: 'afterRequest'; providerId: string; durationMs: number }
  | { type: 'error'; providerId: string; error: unknown }
  | { type: 'usage'; providerId: string; usage: LLMUsage };

export type ProviderHooks = {
  onEvent?: (event: ProviderLifecycleEvent) => void;
};

const noop = (): void => undefined;

export function createHooks(hooks?: ProviderHooks): ProviderHooks {
  return {
    onEvent: hooks?.onEvent ?? noop,
  };
}
