import { describe, expect, it } from 'vitest';
import { heuristicNextBestAction } from '../../src/sales/next-best-action.js';
import { canTransitionLeadStatus } from '../../src/sales/pipeline.js';
import type { LeadLike } from '../../src/sales/types.js';

function makeLead(overrides: Partial<LeadLike>): LeadLike {
  return {
    id: 'lead-1',
    userId: 'user-1',
    name: 'Jane',
    company: null,
    position: null,
    email: null,
    phone: null,
    linkedinUrl: null,
    website: null,
    source: null,
    opportunityId: null,
    score: 0,
    status: 'NEW',
    estimatedValue: null,
    probability: 0,
    lastContactAt: null,
    nextFollowUpAt: null,
    notes: null,
    ...overrides,
  };
}

describe('lead pipeline transitions', () => {
  it('allows forward movement through active stages', () => {
    expect(canTransitionLeadStatus('NEW', 'QUALIFIED')).toBe(true);
    expect(canTransitionLeadStatus('CONTACTED', 'RESPONDED')).toBe(true);
    expect(canTransitionLeadStatus('PROPOSAL', 'NEGOTIATION')).toBe(true);
  });

  it('allows moving backward between active stages', () => {
    expect(canTransitionLeadStatus('PROPOSAL', 'MEETING')).toBe(true);
    expect(canTransitionLeadStatus('RESPONDED', 'CONTACTED')).toBe(true);
  });

  it('allows moving to LOST from any active stage', () => {
    for (const status of [
      'NEW',
      'QUALIFIED',
      'CONTACTED',
      'RESPONDED',
      'MEETING',
      'PROPOSAL',
      'NEGOTIATION',
    ]) {
      expect(canTransitionLeadStatus(status as never, 'LOST')).toBe(true);
    }
  });

  it('only allows winning from deep stages', () => {
    expect(canTransitionLeadStatus('NEW', 'WON')).toBe(false);
    expect(canTransitionLeadStatus('QUALIFIED', 'WON')).toBe(false);
    expect(canTransitionLeadStatus('CONTACTED', 'WON')).toBe(false);
    expect(canTransitionLeadStatus('RESPONDED', 'WON')).toBe(true);
    expect(canTransitionLeadStatus('MEETING', 'WON')).toBe(true);
    expect(canTransitionLeadStatus('PROPOSAL', 'WON')).toBe(true);
    expect(canTransitionLeadStatus('NEGOTIATION', 'WON')).toBe(true);
  });

  it('treats WON and LOST as terminal', () => {
    expect(canTransitionLeadStatus('WON', 'LOST')).toBe(false);
    expect(canTransitionLeadStatus('WON', 'NEGOTIATION')).toBe(false);
    expect(canTransitionLeadStatus('LOST', 'NEW')).toBe(false);
    expect(canTransitionLeadStatus('LOST', 'WON')).toBe(false);
  });

  it('treats staying in the same status as valid', () => {
    expect(canTransitionLeadStatus('WON', 'WON')).toBe(true);
    expect(canTransitionLeadStatus('NEW', 'NEW')).toBe(true);
  });
});

describe('heuristic next best action', () => {
  it('recommends qualification for a new lead', () => {
    const action = heuristicNextBestAction(makeLead({ status: 'NEW' }));
    expect(action.action.toLowerCase()).toContain('qualify');
    expect(action.priority).toBe('high');
  });

  it('recommends onboarding for a won lead', () => {
    const action = heuristicNextBestAction(makeLead({ status: 'WON' }));
    expect(action.action.toLowerCase()).toContain('onboard');
  });

  it('recommends logging the loss for a lost lead', () => {
    const action = heuristicNextBestAction(makeLead({ status: 'LOST' }));
    expect(action.action.toLowerCase()).toContain('log');
    expect(action.priority).toBe('low');
  });

  it('flags an overdue follow-up as high priority', () => {
    const action = heuristicNextBestAction(
      makeLead({
        status: 'PROPOSAL',
        nextFollowUpAt: new Date(Date.now() - 86_400_000 * 2),
      }),
    );
    expect(action.priority).toBe('high');
    expect(action.action.toLowerCase()).toContain('follow up');
  });

  it('prefers email when the lead has one', () => {
    const action = heuristicNextBestAction(
      makeLead({ status: 'QUALIFIED', email: 'jane@acme.com' }),
    );
    expect(action.channel).toBe('email');
  });
});
