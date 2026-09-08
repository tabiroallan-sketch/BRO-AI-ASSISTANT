export * from './types.js';
export { googleMapsProvider } from './providers/google-maps.js';
export { webSearchProvider } from './providers/web-search.js';
export { redditProvider } from './providers/reddit.js';
export { linkedinProvider } from './providers/linkedin.js';
export { indeedProvider } from './providers/indeed.js';
export {
  registerLeadProvider,
  getLeadProvider,
  listLeadProviders,
  getLeadProvidersForSources,
  getProviderStatuses,
  sourceLabel,
} from './provider-registry.js';
export { searchProviders, combineResults } from './orchestrator.js';
export { normalizeLead, deduplicateLeads } from './normalize.js';
export { enrichLead, scoreLead } from './enrichment.js';
export { parseSearchQuery } from './query-parser.js';
export {
  generateOutreach,
  generateMultiChannelOutreach,
  type OutreachTone,
  type OutreachResult,
} from './outreach.js';
export { registerLeadFinderTools } from './tools.js';
export { getLiveProviderStatuses } from './provider-status.js';
export { emitLeadEvent, onLeadEvent, clearLeadEventHandlers, type LeadEvent } from './events.js';
export { buildXlsx } from './xlsx.js';
export {
  reloadLeadCredentials,
  getLeadCredential,
  getLeadCredentialSync,
  resolveLeadApiKey,
  invalidateLeadCredentialCache,
} from './credentials.js';

import { registerLeadProvider } from './provider-registry.js';
import { googleMapsProvider } from './providers/google-maps.js';
import { webSearchProvider } from './providers/web-search.js';
import { redditProvider } from './providers/reddit.js';
import { linkedinProvider } from './providers/linkedin.js';
import { indeedProvider } from './providers/indeed.js';

export function registerDefaultLeadProviders(): void {
  registerLeadProvider(googleMapsProvider);
  registerLeadProvider(webSearchProvider);
  registerLeadProvider(redditProvider);
  registerLeadProvider(linkedinProvider);
  registerLeadProvider(indeedProvider);
}

registerDefaultLeadProviders();
