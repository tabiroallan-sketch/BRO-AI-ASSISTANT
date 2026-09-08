import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLeadEventHandlers,
  emitLeadEvent,
  onLeadEvent,
  type LeadEvent,
} from '../../src/lead-finder/events.js';

describe('lead finder event emitter', () => {
  const savedWebhook = process.env.N8N_LEAD_WEBHOOK_URL;

  afterEach(() => {
    clearLeadEventHandlers();
    vi.restoreAllMocks();
    process.env.N8N_LEAD_WEBHOOK_URL = savedWebhook;
  });

  it('delivers events to subscribed handlers, then unsubscribes', () => {
    const received = vi.fn<(event: LeadEvent) => void>();
    const unsubscribe = onLeadEvent(received);

    emitLeadEvent({ type: 'lead.discovered', userId: 'u1', leadCount: 3 });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]![0].type).toBe('lead.discovered');

    unsubscribe();
    emitLeadEvent({
      type: 'lead.saved',
      userId: 'u1',
      leadId: 'l1',
      companyName: 'Acme Dental',
      leadScore: 88,
    });
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber from other subscribers', () => {
    const bad = (): void => {
      throw new Error('boom');
    };
    const good = vi.fn<(event: LeadEvent) => void>();
    onLeadEvent(bad);
    onLeadEvent(good);

    expect(() =>
      emitLeadEvent({
        type: 'lead.qualified',
        userId: 'u1',
        leadId: 'l1',
        companyName: 'Acme Dental',
      }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after clearLeadEventHandlers', () => {
    const received = vi.fn<(event: LeadEvent) => void>();
    onLeadEvent(received);
    clearLeadEventHandlers();

    emitLeadEvent({
      type: 'lead.status_changed',
      userId: 'u1',
      leadId: 'l1',
      companyName: 'Acme Dental',
      status: 'QUALIFIED',
    });
    expect(received).not.toHaveBeenCalled();
  });

  it('forwards events to the configured webhook without failing the caller', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    process.env.N8N_LEAD_WEBHOOK_URL = 'https://hooks.example.invalid/lead';

    clearLeadEventHandlers();
    const { emitLeadEvent: emitFresh } =
      await import('../../src/lead-finder/events.js?webhook-test');

    expect(() =>
      emitFresh({
        type: 'lead.saved',
        userId: 'u1',
        leadId: 'l1',
        companyName: 'Acme',
        leadScore: 80,
      }),
    ).not.toThrow();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const callArgs = fetchMock.mock.calls[0]!;
    expect(callArgs[0]).toBe('https://hooks.example.invalid/lead');
    vi.unstubAllGlobals();
  });
});
