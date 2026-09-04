'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Compass,
  Download,
  Linkedin,
  Loader2,
  Mail,
  Search,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  fetchLeadProviders,
  searchLeads,
  saveLead,
  listSavedLeads,
  enrichSavedLead,
  generateLeadOutreach,
  deleteSavedLead,
  updateSavedLead,
  type LeadProviderStatus,
  type SavedLead,
  type ScoredLead,
  type LeadSource,
  type OutreachMessage,
} from '@/lib/lead-finder';

const SOURCE_LABELS: Record<string, string> = {
  google_maps: 'Google Maps',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  reddit: 'Reddit',
  web: 'Web',
};

const SOURCE_ORDER: LeadSource[] = ['google_maps', 'linkedin', 'indeed', 'reddit', 'web'];

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function scoreVariant(total: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (total >= 70) return 'default';
  if (total >= 40) return 'secondary';
  return 'outline';
}

type Tab = 'search' | 'saved';

type DetailLead = {
  lead: SavedLead;
  enrichment?: { summary?: string; recommendedApproach?: string };
  outreach?: OutreachMessage[];
  loading?: 'enrich' | 'outreach';
};

export default function LeadFinderPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [tab, setTab] = React.useState<Tab>('search');
  const [providers, setProviders] = React.useState<LeadProviderStatus[]>([]);
  const [selectedSources, setSelectedSources] = React.useState<LeadSource[]>(SOURCE_ORDER);
  const [query, setQuery] = React.useState('');
  const [enrichResults, setEnrichResults] = React.useState(true);
  const [searching, setSearching] = React.useState(false);
  const [scored, setScored] = React.useState<ScoredLead[]>([]);
  const [searchErrors, setSearchErrors] = React.useState<
    Array<{ providerId: string; message: string }>
  >([]);
  const [searchMeta, setSearchMeta] = React.useState<{
    total: number;
    durationMs: number;
    searchId?: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const [savedLeads, setSavedLeads] = React.useState<SavedLead[]>([]);
  const [totalSaved, setTotalSaved] = React.useState(0);
  const [loadingSaved, setLoadingSaved] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<DetailLead | null>(null);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const list = await fetchLeadProviders();
        if (!disposed) setProviders(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) setError('Failed to load lead providers.');
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  async function loadSaved(): Promise<void> {
    setLoadingSaved(true);
    try {
      const result = await listSavedLeads({ sort: 'leadScore', order: 'desc', pageSize: 50 });
      setSavedLeads(result.leads);
      setTotalSaved(result.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load saved leads.');
    } finally {
      setLoadingSaved(false);
    }
  }

  function openSaved(): void {
    setTab('saved');
    if (savedLeads.length === 0) void loadSaved();
  }

  function toggleSource(source: LeadSource): void {
    setSelectedSources((previous) =>
      previous.includes(source) ? previous.filter((s) => s !== source) : [...previous, source],
    );
  }

  async function runSearch(): Promise<void> {
    if (!query.trim()) {
      setError('Enter a search query.');
      return;
    }
    setSearching(true);
    setError(null);
    setScored([]);
    setSearchErrors([]);
    setSearchMeta(null);
    try {
      const result = await searchLeads({
        query: query.trim(),
        parseNatural: true,
        sources: selectedSources,
        enrich: enrichResults,
        limit: 25,
      });
      setScored(result.leads);
      setSearchErrors(result.errors);
      setSearchMeta({
        total: result.total,
        durationMs: result.durationMs,
        searchId: result.searchId,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function handleSave(lead: ScoredLead): Promise<void> {
    setSavingId(lead.lead.id);
    setError(null);
    try {
      const saved = await saveLead({
        companyName: lead.lead.companyName,
        companyDescription: lead.lead.companyDescription,
        industry: lead.lead.industry,
        website: lead.lead.website,
        email: lead.lead.email,
        phone: lead.lead.phone,
        city: lead.lead.city,
        state: lead.lead.state,
        country: lead.lead.country,
        source: lead.lead.source,
        leadScore: lead.score.total,
        hiringSignals: lead.lead.hiringSignals,
        intentSignals: lead.lead.intentSignals,
        painPoints: lead.lead.painPoints,
        automationOpportunities: lead.lead.automationOpportunities,
        searchId: searchMeta?.searchId,
        confidence: lead.lead.confidence,
      });
      setScored((previous) => previous.filter((s) => s.lead.id !== lead.lead.id));
      setDetail({ lead: saved });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to save lead.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setDeletingId(id);
    setError(null);
    try {
      await deleteSavedLead(id);
      setSavedLeads((previous) => previous.filter((l) => l.id !== id));
      setTotalSaved((t) => t - 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete lead.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleEnrich(id: string): Promise<void> {
    setDetail((previous) => (previous ? { ...previous, loading: 'enrich' } : previous));
    setError(null);
    try {
      const { lead, enrichment } = await enrichSavedLead(id);
      setDetail((previous) =>
        previous ? { ...previous, lead, enrichment, loading: undefined } : previous,
      );
      setSavedLeads((previous) => previous.map((l) => (l.id === id ? lead : l)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to enrich lead.');
      setDetail((previous) => (previous ? { ...previous, loading: undefined } : previous));
    }
  }

  async function handleOutreach(id: string): Promise<void> {
    setDetail((previous) => (previous ? { ...previous, loading: 'outreach' } : previous));
    setError(null);
    try {
      const { outreach } = await generateLeadOutreach(id, {
        channel: 'cold_email',
        tone: 'professional',
      });
      setDetail((previous) =>
        previous ? { ...previous, outreach, loading: undefined } : previous,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to generate outreach.');
      setDetail((previous) => (previous ? { ...previous, loading: undefined } : previous));
    }
  }

  async function handleStatusChange(id: string, status: string): Promise<void> {
    setError(null);
    try {
      const updated = await updateSavedLead(id, { status });
      setSavedLeads((previous) => previous.map((l) => (l.id === id ? updated : l)));
      setDetail((previous) => (previous ? { ...previous, lead: updated } : previous));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    }
  }

  if (user === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <DashboardPageHeader
        title="Lead Finder"
        description="Discover businesses across Google Maps, LinkedIn, Indeed, Reddit, and the web, enriched and scored by AI."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-6 flex gap-2">
        <Button variant={tab === 'search' ? 'default' : 'outline'} onClick={() => setTab('search')}>
          <Search className="h-4 w-4" /> Search
        </Button>
        <Button variant={tab === 'saved' ? 'default' : 'outline'} onClick={openSaved}>
          <Users className="h-4 w-4" /> Saved leads
          {totalSaved > 0 && <Badge variant="secondary">{totalSaved}</Badge>}
        </Button>
      </div>

      {tab === 'search' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search for leads</CardTitle>
              <CardDescription>
                Describe the type of customer you want in plain language — the AI parses it into a
                structured multi-source search.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="lf-query">Query</Label>
                <Textarea
                  id="lf-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Dental clinics in Austin, TX with over 20 staff that need patient scheduling software"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sources</Label>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_ORDER.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => toggleSource(source)}
                      className={`rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                        selectedSources.includes(source)
                          ? 'border-neon-cyan/50 bg-neon-cyan/5'
                          : 'border-input hover:bg-accent/60'
                      }`}
                    >
                      {sourceLabel(source)}
                    </button>
                  ))}
                </div>
                {providers.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Configuration:{' '}
                    {providers
                      .map(
                        (provider) =>
                          `${sourceLabel(provider.id)} ${provider.configured ? 'ready' : 'needs key'}`,
                      )
                      .join(' · ')}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enrichResults}
                  onChange={(event) => setEnrichResults(event.target.checked)}
                />
                AI-enrich top results (pain points, automation opportunities, scoring)
              </label>
              <Button onClick={() => void runSearch()} disabled={searching}>
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </CardContent>
          </Card>

          {searchMeta && (
            <p className="mt-4 text-xs text-muted-foreground">
              Found {searchMeta.total} leads in {(searchMeta.durationMs / 1000).toFixed(1)}s
              {searchErrors.length > 0 && ` · ${searchErrors.length} provider warning(s)`}
            </p>
          )}

          {searchErrors.length > 0 && (
            <div className="mt-2 space-y-1">
              {searchErrors.map((item, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  {sourceLabel(item.providerId)}: {item.message}
                </p>
              ))}
            </div>
          )}

          <div className="mt-6 space-y-2">
            {scored.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {searching ? 'Searching providers…' : 'Run a search to see scored leads here.'}
              </p>
            ) : (
              scored.map((item) => (
                <div key={item.lead.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.lead.companyName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[item.lead.city, item.lead.state, item.lead.country]
                          .filter(Boolean)
                          .join(', ') || 'Location unknown'}
                        {item.lead.website ? ` · ${item.lead.website}` : ''}
                        {item.lead.industry ? ` · ${item.lead.industry}` : ''}
                      </p>
                      {item.lead.hiringSignals?.length ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {item.lead.hiringSignals.slice(0, 3).map((signal, idx) => (
                            <Badge key={idx} variant="outline">
                              {signal}
                            </Badge>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={scoreVariant(item.score.total)}>
                        Score {item.score.total}
                      </Badge>
                      <Badge variant="secondary">{item.sources.map(sourceLabel).join('+')}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === item.lead.id}
                        onClick={() => void handleSave(item)}
                      >
                        {savingId === item.lead.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Compass className="h-4 w-4" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === 'saved' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved leads</CardTitle>
            <CardDescription>
              Leads you&apos;ve saved from searches, scored and ready for outreach.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSaved ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : savedLeads.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No saved leads yet. Run a search and save a lead.
              </p>
            ) : (
              <div className="space-y-2">
                {savedLeads.map((lead) => (
                  <div key={lead.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{lead.companyName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[lead.city, lead.state, lead.country].filter(Boolean).join(', ') ||
                            'Location unknown'}
                          {lead.website ? ` · ${lead.website}` : ''}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="secondary">{sourceLabel(lead.source)}</Badge>
                          <select
                            value={lead.status}
                            onChange={(event) =>
                              void handleStatusChange(lead.id, event.target.value)
                            }
                            className="rounded border bg-transparent px-1 py-0.5 text-xs"
                          >
                            {[
                              'NEW',
                              'QUALIFIED',
                              'CONTACTED',
                              'RESPONDED',
                              'MEETING',
                              'PROPOSAL',
                              'WON',
                              'LOST',
                            ].map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant={scoreVariant(lead.leadScore)}>Score {lead.leadScore}</Badge>
                        <Button size="sm" variant="outline" onClick={() => setDetail({ lead })}>
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deletingId === lead.id}
                          onClick={() => void handleDelete(lead.id)}
                        >
                          {deletingId === lead.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Delete'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{detail.lead.companyName}</h2>
                <p className="text-xs text-muted-foreground">
                  {[detail.lead.city, detail.lead.state, detail.lead.country]
                    .filter(Boolean)
                    .join(', ') || 'Location unknown'}
                  {detail.lead.industry ? ` · ${detail.lead.industry}` : ''}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg border px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60"
              >
                Close
              </button>
            </div>

            {detail.lead.website && (
              <a
                href={detail.lead.website}
                target="_blank"
                rel="noreferrer"
                className="mb-3 inline-block text-sm text-neon-cyan underline"
              >
                {detail.lead.website}
              </a>
            )}

            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={detail.loading === 'enrich'}
                onClick={() => void handleEnrich(detail.lead.id)}
              >
                {detail.loading === 'enrich' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Enrich
              </Button>
              <Button
                size="sm"
                disabled={detail.loading === 'outreach'}
                onClick={() => void handleOutreach(detail.lead.id)}
              >
                {detail.loading === 'outreach' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Generate outreach
              </Button>
              {detail.lead.linkedinUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={detail.lead.linkedinUrl} target="_blank" rel="noreferrer">
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </a>
                </Button>
              )}
              {detail.lead.googleMapsUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={detail.lead.googleMapsUrl} target="_blank" rel="noreferrer">
                    <Store className="h-4 w-4" /> Maps
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={loadSaved}>
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </div>

            {detail.enrichment && (
              <div className="mb-4 rounded-lg border p-3">
                <h3 className="mb-2 text-sm font-semibold">Enrichment</h3>
                <p className="text-sm text-muted-foreground">{detail.enrichment.summary}</p>
                <p className="mt-2 text-sm">
                  <strong>Recommended approach:</strong> {detail.enrichment.recommendedApproach}
                </p>
              </div>
            )}

            {detail.outreach && detail.outreach.length > 0 && (
              <div className="space-y-3">
                {detail.outreach.map((message, index) => (
                  <div key={index} className="rounded-lg border p-3">
                    <Badge variant="secondary">{message.channel}</Badge>
                    {message.subject && (
                      <p className="mt-2 text-sm font-medium">{message.subject}</p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {message.body}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {!detail.enrichment && !detail.outreach && (
              <p className="text-sm text-muted-foreground">
                Use Enrich to research this lead and Generate outreach to draft a message.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
