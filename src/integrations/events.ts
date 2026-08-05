import type { ConnectionStatus } from './types.js';
import type { ProviderErrorCode } from './errors.js';

export type IntegrationEvent =
  | { type: 'connected'; provider: string; userId: string; accountName: string | null }
  | { type: 'disconnected'; provider: string; userId: string }
  | { type: 'token_refreshed'; provider: string; userId: string }
  | { type: 'token_revoked'; provider: string; userId: string; reason: string }
  | { type: 'health_changed'; provider: string; userId: string; status: ConnectionStatus }
  | { type: 'error'; provider: string; userId: string; code: ProviderErrorCode; message: string };

export type IntegrationEventHandler = (event: IntegrationEvent) => void;

const handlers = new Set<IntegrationEventHandler>();

/**
 * Subscribes to integration lifecycle events. Returns an unsubscribe function.
 * Subscribers must not throw: emitIntegrationEvent isolates failures.
 */
export function onIntegrationEvent(handler: IntegrationEventHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function emitIntegrationEvent(event: IntegrationEvent): void {
  for (const handler of [...handlers]) {
    try {
      handler(event);
    } catch {
      // A misbehaving subscriber must never break the emitter or the caller.
    }
  }
}

export function clearIntegrationEventHandlers(): void {
  handlers.clear();
}
