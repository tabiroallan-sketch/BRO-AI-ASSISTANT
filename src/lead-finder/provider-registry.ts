import type { LeadProvider, LeadSource } from './types.js';

const providers = new Map<string, LeadProvider>();

export function registerLeadProvider(provider: LeadProvider): void {
  providers.set(provider.id, provider);
}

export function getLeadProvider(id: string): LeadProvider | undefined {
  return providers.get(id);
}

export function listLeadProviders(): LeadProvider[] {
  return [...providers.values()];
}

export function getLeadProvidersForSources(sources: LeadSource[]): LeadProvider[] {
  if (!sources.length) return listLeadProviders();
  return listLeadProviders().filter((p) => p.sources.some((s) => sources.includes(s)));
}

export function getProviderStatuses(): Array<{
  id: string;
  label: string;
  configured: boolean;
  sources: LeadSource[];
}> {
  return listLeadProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    sources: p.sources,
  }));
}

export function sourceLabel(source: LeadSource): string {
  const labels: Record<LeadSource, string> = {
    google_maps: 'Google Maps',
    linkedin: 'LinkedIn',
    indeed: 'Indeed',
    reddit: 'Reddit',
    web: 'Web Search',
    ai_extension: 'AI Extension',
  };
  return labels[source] ?? source;
}
