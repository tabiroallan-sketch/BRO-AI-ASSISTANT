'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Compass, Loader2, Search } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  discoverOpportunities,
  fetchDiscoverySources,
  submitOpportunity,
  type DiscoverySource,
  type OpportunityCandidate,
} from '@/lib/sales';

function reliabilityVariant(
  reliability: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (reliability) {
    case 'HIGH':
      return 'default';
    case 'MEDIUM':
      return 'secondary';
    case 'LOW':
      return 'outline';
    default:
      return 'secondary';
  }
}

function typeVariant(type: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'JOB':
      return 'default';
    case 'OUTSOURCING':
      return 'outline';
    default:
      return 'secondary';
  }
}

function SourceToggle({
  source,
  selected,
  onToggle,
}: {
  source: DiscoverySource;
  selected: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        selected ? 'border-neon-cyan/50 bg-neon-cyan/5' : 'border-input hover:bg-accent/60'
      }`}
    >
      <span className="block font-medium">{source.label}</span>
      <span className="text-xs text-muted-foreground">{source.id}</span>
    </button>
  );
}

export default function DiscoveryPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [sources, setSources] = React.useState<DiscoverySource[]>([]);
  const [selectedSources, setSelectedSources] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [companyWebsite, setCompanyWebsite] = React.useState('');
  const [saveOnDiscover, setSaveOnDiscover] = React.useState(true);
  const [candidates, setCandidates] = React.useState<OpportunityCandidate[]>([]);
  const [savedCount, setSavedCount] = React.useState(0);
  const [errors, setErrors] = React.useState<Array<{ source: string; message: string }>>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [manualTitle, setManualTitle] = React.useState('');
  const [manualCompany, setManualCompany] = React.useState('');
  const [manualBudget, setManualBudget] = React.useState('');
  const [manualDescription, setManualDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const list = await fetchDiscoverySources();
        if (!disposed) {
          setSources(list);
          setSelectedSources(list.map((source) => source.id));
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load discovery sources.');
        }
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  async function runSearch(): Promise<void> {
    if (!query.trim() && !url.trim() && !companyWebsite.trim()) {
      setError('Provide a search query, a URL, or a company website.');
      return;
    }
    setSearching(true);
    setError(null);
    setCandidates([]);
    setErrors([]);
    try {
      const result = await discoverOpportunities({
        query: query.trim() || undefined,
        url: url.trim() || undefined,
        companyWebsite: companyWebsite.trim() || undefined,
        sources: selectedSources,
        limit: 20,
        save: saveOnDiscover,
      });
      setCandidates(result.candidates);
      setSavedCount(result.savedCount);
      setErrors(result.errors);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Discovery failed.');
    } finally {
      setSearching(false);
    }
  }

  async function submitManual(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const budget = Number(manualBudget);
      await submitOpportunity({
        title: manualTitle.trim(),
        ...(manualCompany.trim() ? { company: manualCompany.trim() } : {}),
        ...(manualDescription.trim() ? { description: manualDescription.trim() } : {}),
        ...(manualBudget.trim() && Number.isFinite(budget) && budget >= 0
          ? { estimatedBudget: budget }
          : {}),
      });
      setManualTitle('');
      setManualCompany('');
      setManualBudget('');
      setManualDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit the opportunity.');
    } finally {
      setSubmitting(false);
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
        title="Discovery"
        description="Find opportunities from safe public sources and normalize them into your pipeline."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Search the web</CardTitle>
            <CardDescription>
              Public search results, a specific listing URL, or a company careers page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="discover-query" className="text-sm font-medium">
                Query
              </label>
              <Input
                id="discover-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="freelance react developer contract"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="discover-url" className="text-sm font-medium">
                  Listing URL
                </label>
                <Input
                  id="discover-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/careers/job"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="discover-company" className="text-sm font-medium">
                  Company website
                </label>
                <Input
                  id="discover-company"
                  value={companyWebsite}
                  onChange={(event) => setCompanyWebsite(event.target.value)}
                  placeholder="https://acme.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Sources</p>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <SourceToggle
                    key={source.id}
                    source={source}
                    selected={selectedSources.includes(source.id)}
                    onToggle={() => {
                      setSelectedSources((previous) =>
                        previous.includes(source.id)
                          ? previous.filter((id) => id !== source.id)
                          : [...previous, source.id],
                      );
                    }}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveOnDiscover}
                onChange={(event) => setSaveOnDiscover(event.target.checked)}
              />
              Save found opportunities into the pipeline
            </label>
            <Button onClick={() => void runSearch()} disabled={searching}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Discover
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit an opportunity</CardTitle>
            <CardDescription>
              Paste a job, RFP, or project you found yourself. It is saved as a high-reliability
              candidate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitManual} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="manual-title" className="text-sm font-medium">
                  Title
                </label>
                <Input
                  id="manual-title"
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                  placeholder="Rebuild our booking system"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="manual-company" className="text-sm font-medium">
                    Company
                  </label>
                  <Input
                    id="manual-company"
                    value={manualCompany}
                    onChange={(event) => setManualCompany(event.target.value)}
                    placeholder="Acme"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="manual-budget" className="text-sm font-medium">
                    Estimated budget (USD)
                  </label>
                  <Input
                    id="manual-budget"
                    type="number"
                    min={0}
                    value={manualBudget}
                    onChange={(event) => setManualBudget(event.target.value)}
                    placeholder="12000"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="manual-description" className="text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="manual-description"
                  value={manualDescription}
                  onChange={(event) => setManualDescription(event.target.value)}
                  placeholder="What they need, deadlines, requirements…"
                  rows={3}
                />
              </div>
              <Button type="submit" disabled={submitting || !manualTitle.trim()}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Compass className="h-4 w-4" />
                )}
                Save opportunity
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Results</h2>
          {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {savedCount > 0 && <Badge>{savedCount} saved</Badge>}
        </div>
        {errors.length > 0 && (
          <div className="mb-3 space-y-1">
            {errors.map((item, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                {item.source}: {item.message}
              </p>
            ))}
          </div>
        )}
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Run a discovery search to see normalized candidates here.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((candidate, index) => (
              <div key={`${candidate.sourceUrl}-${index}`} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{candidate.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.company ?? 'Unknown company'}
                      {candidate.sourceUrl ? ` · ${candidate.sourceUrl}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={reliabilityVariant(candidate.sourceReliability)}>
                      {candidate.sourceReliability}
                    </Badge>
                    <Badge variant={typeVariant(candidate.type)}>
                      {candidate.type.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                </div>
                {candidate.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {candidate.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{candidate.typeReason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
