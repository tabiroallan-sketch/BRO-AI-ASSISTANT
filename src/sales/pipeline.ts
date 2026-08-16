import type { LeadStatusValue } from './types.js';

/** Statuses a lead can move between while still being actively worked. */
export const ACTIVE_LEAD_STATUSES: LeadStatusValue[] = [
  'NEW',
  'QUALIFIED',
  'CONTACTED',
  'RESPONDED',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
];

/** Pipeline order used for stage summaries. */
export const LEAD_PIPELINE_ORDER: LeadStatusValue[] = [...ACTIVE_LEAD_STATUSES, 'WON', 'LOST'];

/** Statuses that can be advanced to from an active stage before winning. */
const WINNERS_FROM: LeadStatusValue[] = ['RESPONDED', 'MEETING', 'PROPOSAL', 'NEGOTIATION'];

/**
 * A deal is terminal once it is WON or LOST. From an active status you may move
 * to any other active status (forward or backward) and to LOST; you may only
 * move to WON once the relationship is deep enough (responded onwards).
 */
export function canTransitionLeadStatus(from: LeadStatusValue, to: LeadStatusValue): boolean {
  if (from === to) {
    return true;
  }
  if (from === 'WON' || from === 'LOST') {
    return false;
  }
  if (to === 'LOST') {
    return true;
  }
  if (to === 'WON') {
    return WINNERS_FROM.includes(from);
  }
  return ACTIVE_LEAD_STATUSES.includes(from) && ACTIVE_LEAD_STATUSES.includes(to);
}
