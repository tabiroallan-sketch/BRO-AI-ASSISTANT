import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearIntegrationEventHandlers,
  emitIntegrationEvent,
  onIntegrationEvent,
} from '../../src/integrations/events.js';

describe('integration event system', () => {
  beforeEach(() => {
    clearIntegrationEventHandlers();
  });

  it('delivers events to subscribers', () => {
    const handler = vi.fn();
    onIntegrationEvent(handler);
    emitIntegrationEvent({
      type: 'connected',
      provider: 'github',
      userId: 'u1',
      accountName: 'octocat',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: 'connected',
      provider: 'github',
      userId: 'u1',
      accountName: 'octocat',
    });
  });

  it('delivers to every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    onIntegrationEvent(first);
    onIntegrationEvent(second);
    emitIntegrationEvent({ type: 'disconnected', provider: 'slack', userId: 'u1' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = onIntegrationEvent(handler);
    unsubscribe();
    emitIntegrationEvent({ type: 'token_refreshed', provider: 'github', userId: 'u1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates a throwing subscriber from the emitter', () => {
    const throwing = vi.fn(() => {
      throw new Error('subscriber bug');
    });
    const healthy = vi.fn();
    onIntegrationEvent(throwing);
    onIntegrationEvent(healthy);
    expect(() =>
      emitIntegrationEvent({
        type: 'health_changed',
        provider: 'github',
        userId: 'u1',
        status: 'connected',
      }),
    ).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('clears all handlers', () => {
    const handler = vi.fn();
    onIntegrationEvent(handler);
    clearIntegrationEventHandlers();
    emitIntegrationEvent({
      type: 'error',
      provider: 'github',
      userId: 'u1',
      code: 'NETWORK',
      message: 'x',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
