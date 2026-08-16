'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  createOpportunity,
  deleteOpportunity,
  listOpportunities,
  updateOpportunity,
  type Opportunity,
  type OpportunityStatus,
  type OpportunityType,
} from '@/lib/sales';

const STATUSES: OpportunityStatus[] = ['NEW', 'EVALUATING', 'PROPOSED', 'WON', 'LOST'];
const TYPES: OpportunityType[] = [
  'JOB',
  'POTENTIAL_CLIENT',
  'OUTSOURCING',
  'PARTNERSHIP',
  'RECURRING',
];

function statusVariant(
  status: OpportunityStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'WON':
      return 'default';
    case 'LOST':
      return 'destructive';
    case 'PROPOSED':
      return 'default';
    case 'EVALUATING':
      return 'secondary';
    case 'NEW':
      return 'outline';
  }
}

function typeVariant(type: OpportunityType): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'JOB':
      return 'default';
    case 'RECURRING':
      return 'default';
    case 'POTENTIAL_CLIENT':
      return 'secondary';
    case 'OUTSOURCING':
    case 'PARTNERSHIP':
      return 'outline';
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function AddOpportunityForm({
  onAdded,
}: {
  onAdded: (opportunity: Opportunity) => void;
}): React.JSX.Element {
  const [title, setTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [estimatedBudget, setEstimatedBudget] = React.useState('');
  const [type, setType] = React.useState<OpportunityType>('POTENTIAL_CLIENT');
  const [requiredSkills, setRequiredSkills] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const budget = Number(estimatedBudget);
      const { opportunity } = await createOpportunity({
        title: title.trim(),
        ...(company.trim() ? { company: company.trim() } : {}),
        type,
        ...(estimatedBudget.trim() && Number.isFinite(budget) && budget >= 0
          ? { estimatedBudget: budget }
          : {}),
        ...(requiredSkills.trim()
          ? {
              requiredSkills: requiredSkills
                .split(',')
                .map((skill) => skill.trim())
                .filter(Boolean),
            }
          : {}),
      });
      onAdded(opportunity);
      setTitle('');
      setCompany('');
      setEstimatedBudget('');
      setType('POTENTIAL_CLIENT');
      setRequiredSkills('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the opportunity.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add an opportunity</CardTitle>
        <CardDescription>
          Log a job, RFP, or potential client manually. It is scored automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="opp-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="opp-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Landing page for a local bakery"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="opp-company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="opp-company"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Acme"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="opp-budget" className="text-sm font-medium">
                Estimated budget (USD)
              </label>
              <Input
                id="opp-budget"
                type="number"
                min={0}
                value={estimatedBudget}
                onChange={(event) => setEstimatedBudget(event.target.value)}
                placeholder="5000"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="opp-type" className="text-sm font-medium">
                Type
              </label>
              <select
                id="opp-type"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={type}
                onChange={(event) => setType(event.target.value as OpportunityType)}
              >
                {TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="opp-skills" className="text-sm font-medium">
                Required skills (comma separated)
              </label>
              <Input
                id="opp-skills"
                value={requiredSkills}
                onChange={(event) => setRequiredSkills(event.target.value)}
                placeholder="react, nextjs"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !title.trim()}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add opportunity
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OpportunityCard({
  opportunity,
  onStatusChange,
  onDelete,
}: {
  opportunity: Opportunity;
  onStatusChange: (status: OpportunityStatus) => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{opportunity.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {opportunity.company ?? 'Unknown company'}
            {opportunity.source ? ` · via ${opportunity.source}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={typeVariant(opportunity.type)}>
            {opportunity.type.replaceAll('_', ' ')}
          </Badge>
          <Badge variant={statusVariant(opportunity.status)}>{opportunity.status}</Badge>
          <Badge>{opportunity.score}</Badge>
        </div>
      </div>
      {opportunity.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{opportunity.description}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Budget: {formatMoney(opportunity.estimatedBudget)}</span>
        {opportunity.deadline && <span>Deadline: {formatDate(opportunity.deadline)}</span>}
        {opportunity.requiredSkills.length > 0 && (
          <span>Skills: {opportunity.requiredSkills.join(', ')}</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
          value={opportunity.status}
          onChange={(event) => onStatusChange(event.target.value as OpportunityStatus)}
          aria-label="Update status"
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

export default function OpportunitiesPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [opportunities, setOpportunities] = React.useState<Opportunity[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [filter, setFilter] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const list = await listOpportunities({ status: filter || undefined });
      setOpportunities(list);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load opportunities.');
    } finally {
      setLoaded(true);
    }
  }

  React.useEffect(() => {
    let disposed = false;
    async function run(): Promise<void> {
      try {
        const list = await listOpportunities();
        if (!disposed) {
          setOpportunities(list);
          setError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load opportunities.');
        }
      } finally {
        if (!disposed) {
          setLoaded(true);
        }
      }
    }
    void run();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

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
        title="Opportunities"
        description="Track jobs, RFPs, and potential clients. Score and stage each one."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">All opportunities</CardTitle>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    aria-label="Filter by status"
                  >
                    <option value="">All statuses</option>
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {!loaded ? (
                <div className="flex min-h-[20vh] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : opportunities.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No opportunities yet. Add one or use Discovery.
                </p>
              ) : (
                opportunities.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    onStatusChange={async (status) => {
                      const updated = await updateOpportunity(opportunity.id, { status });
                      setOpportunities((previous) =>
                        previous.map((item) => (item.id === updated.id ? updated : item)),
                      );
                    }}
                    onDelete={async () => {
                      await deleteOpportunity(opportunity.id);
                      setOpportunities((previous) =>
                        previous.filter((item) => item.id !== opportunity.id),
                      );
                    }}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <AddOpportunityForm
            onAdded={(opportunity) => {
              setOpportunities((previous) => [opportunity, ...previous]);
            }}
          />
        </div>
      </div>
    </div>
  );
}
