'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, ExternalLink, Loader2, MapPin, Search, Zap } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { createOpportunity, discoverOpportunities, type OpportunityCandidate } from '@/lib/sales';

const JOB_BOARD_SOURCES = ['serpapi-jobs', 'indeed-rss'];

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

function sourceLabel(source: string): string {
  switch (source) {
    case 'serpapi-jobs':
      return 'Google Jobs';
    case 'indeed-rss':
      return 'Indeed';
    default:
      return source;
  }
}

export default function JobSearchPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [query, setQuery] = React.useState('');
  const [candidates, setCandidates] = React.useState<OpportunityCandidate[]>([]);
  const [errors, setErrors] = React.useState<Array<{ source: string; message: string }>>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<number>>(new Set());
  const [savingAll, setSavingAll] = React.useState(false);

  async function runSearch(): Promise<void> {
    if (!query.trim()) {
      setError('Enter a search query to find jobs.');
      return;
    }
    setSearching(true);
    setError(null);
    setCandidates([]);
    setErrors([]);
    setSavedIds(new Set());
    try {
      const result = await discoverOpportunities({
        query: query.trim(),
        sources: JOB_BOARD_SOURCES,
        limit: 20,
        save: false,
      });
      setCandidates(result.candidates);
      setErrors(result.errors);
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

  async function saveCandidate(candidate: OpportunityCandidate, index: number): Promise<void> {
    try {
      await createOpportunity({
        title: candidate.title,
        company: candidate.company ?? undefined,
        description: candidate.description ?? undefined,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl ?? undefined,
        location: candidate.location ?? undefined,
        remote: candidate.remote ?? false,
        compensation: candidate.compensation ?? undefined,
        requiredSkills: candidate.requiredSkills ?? [],
      });
      setSavedIds((prev) => new Set(prev).add(index));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save opportunity.');
    }
  }

  async function saveAll(): Promise<void> {
    setSavingAll(true);
    setError(null);
    let saved = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (savedIds.has(i)) {
        continue;
      }
      try {
        await createOpportunity({
          title: candidates[i].title,
          company: candidates[i].company ?? undefined,
          description: candidates[i].description ?? undefined,
          source: candidates[i].source,
          sourceUrl: candidates[i].sourceUrl ?? undefined,
          location: candidates[i].location ?? undefined,
          remote: candidates[i].remote ?? false,
          compensation: candidates[i].compensation ?? undefined,
          requiredSkills: candidates[i].requiredSkills ?? [],
        });
        saved++;
        setSavedIds((prev) => new Set(prev).add(i));
      } catch {
        // continue saving others
      }
    }
    setSavingAll(false);
    if (saved > 0) {
      setError(null);
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
        title="Job Search"
        description="Search job boards directly from the Command Center. Results come from Google Jobs (aggregates 20+ boards) and Indeed RSS."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
            className="flex gap-3"
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. senior react developer remote, python freelance contract"
              className="flex-1"
            />
            <Button type="submit" disabled={searching}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Results
          {candidates.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {candidates.length} found
            </span>
          )}
        </h2>
        {candidates.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveAll()}
            disabled={savingAll || savedIds.size === candidates.length}
          >
            {savingAll ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Bookmark className="mr-1 h-3 w-3" />
            )}
            {savedIds.size === candidates.length ? 'All saved' : `Save all to pipeline`}
          </Button>
        )}
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
        <p className="py-12 text-center text-sm text-muted-foreground">
          {searching
            ? 'Searching job boards...'
            : 'Enter a query and hit Search to find opportunities across multiple job boards.'}
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate, index) => (
            <Card
              key={`${candidate.sourceUrl}-${index}`}
              className="transition-colors hover:border-border/60"
            >
              <CardContent className="flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{candidate.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {candidate.company && <span>{candidate.company}</span>}
                        {candidate.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {candidate.location}
                          </span>
                        )}
                        {candidate.remote && (
                          <Badge variant="outline" className="text-[10px]">
                            Remote
                          </Badge>
                        )}
                        {candidate.compensation && (
                          <span className="font-medium text-foreground">
                            {candidate.compensation}
                          </span>
                        )}
                        {candidate.postedAt && <span>{candidate.postedAt}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={reliabilityVariant(candidate.sourceReliability)}>
                        {candidate.sourceReliability}
                      </Badge>
                      <Badge variant="outline">{sourceLabel(candidate.source)}</Badge>
                    </div>
                  </div>
                  {candidate.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {candidate.description}
                    </p>
                  )}
                  {candidate.requiredSkills && candidate.requiredSkills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {candidate.requiredSkills.slice(0, 6).map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-[10px]">
                          {skill}
                        </Badge>
                      ))}
                      {candidate.requiredSkills.length > 6 && (
                        <Badge variant="secondary" className="text-[10px]">
                          +{candidate.requiredSkills.length - 6}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  {candidate.sourceUrl && (
                    <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                  <Button
                    variant={savedIds.has(index) ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8"
                    disabled={savedIds.has(index) || savingAll}
                    onClick={() => void saveCandidate(candidate, index)}
                  >
                    {savedIds.has(index) ? (
                      'Saved'
                    ) : (
                      <>
                        <Zap className="mr-1 h-3 w-3" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
