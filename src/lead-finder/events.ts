import { logger } from '../lib/logger.js';

export type LeadDiscoveredPayload = {
  userId: string;
  searchId?: string;
  companyName: string;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  website?: string | null;
  leadScore?: number;
  source: string;
};

export type LeadEvent =
  | { type: 'lead.discovered'; userId: string; searchId?: string; leadCount: number }
  | { type: 'lead.saved'; userId: string; leadId: string; companyName: string; leadScore: number }
  | { type: 'lead.qualified'; userId: string; leadId: string; companyName: string; reason?: string }
  | {
      type: 'lead.status_changed';
      userId: string;
      leadId: string;
      companyName: string;
      status: string;
    }
  | {
      type: 'lead.outreach_generated';
      userId: string;
      leadId: string;
      companyName: string;
      channels: string[];
    };

export type LeadEventHandler = (event: LeadEvent) => void;

const handlers = new Set<LeadEventHandler>();

const N8N_LEAD_WEBHOOK_URL = process.env.N8N_LEAD_WEBHOOK_URL ?? '';

/**
 * Subscribes to lead-finder lifecycle events. Returns an unsubscribe function.
 * Subscribers must not throw: emitLeadEvent isolates failures.
 */
export function onLeadEvent(handler: LeadEventHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function clearLeadEventHandlers(): void {
  handlers.clear();
}

/**
 * Emits a lead lifecycle event to in-process subscribers and (optionally)
 * forwards it to a configured n8n / generic webhook. The webhook is a plain
 * JSON POST with a small `LeadEvent` payload; point it at any webhook URL from
 * n8n, Zapier, Make, etc. Emitting never throws and never blocks the caller.
 */
export function emitLeadEvent(event: LeadEvent): void {
  for (const handler of [...handlers]) {
    try {
      handler(event);
    } catch {
      // A misbehaving subscriber must never break the emitter or the caller.
    }
  }

  if (!N8N_LEAD_WEBHOOK_URL) return;

  void (async (): Promise<void> => {
    try {
      const response = await fetch(N8N_LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, sentAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        logger.warn(`Lead webhook returned HTTP ${response.status} for event ${event.type}`);
      }
    } catch (error) {
      logger.warn(
        `Lead webhook delivery failed for ${event.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  })();
}
