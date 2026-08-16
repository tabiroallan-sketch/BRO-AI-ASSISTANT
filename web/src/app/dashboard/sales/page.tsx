'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Banknote, Compass, FileText, Loader2, Star, TrendingUp, Users } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  fetchSalesOverview,
  listOpportunities,
  type Opportunity,
  type SalesOverview,
} from '@/lib/sales';

const STAGE_ORDER: Array<{ key: string; label: string }> = [
  { key: 'NEW', label: 'New' },
  { key: 'QUALIFIED', label: 'Qualified' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'RESPONDED', label: 'Responded' },
  { key: 'MEETING', label: 'Meeting' },
  { key: 'PROPOSAL', label: 'Proposal' },
  { key: 'NEGOTIATION', label: 'Negotiation' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
];

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '$0';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-lg bg-neon-cyan/10 p-2.5 text-neon-cyan">{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function opportunityTypeVariant(
  type: Opportunity['type'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (type) {
    case 'JOB':
      return 'default';
    case 'POTENTIAL_CLIENT':
      return 'secondary';
    case 'OUTSOURCING':
      return 'outline';
    case 'PARTNERSHIP':
      return 'secondary';
    case 'RECURRING':
      return 'default';
  }
}

export default function SalesOverviewPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [overview, setOverview] = React.useState<SalesOverview | null>(null);
  const [top, setTop] = React.useState<Opportunity[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    async function load(): Promise<void> {
      try {
        const [stats, opportunities] = await Promise.all([
          fetchSalesOverview(),
          listOpportunities({ minScore: 60 }),
        ]);
        if (!disposed) {
          setOverview(stats);
          setTop(opportunities.slice(0, 5));
          setError(null);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        if (!disposed) {
          setError('Failed to load the sales overview.');
        }
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [router, logout]);

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
        title="Sales Command Center"
        description="Your pipeline, opportunities, offers, and sales intelligence at a glance."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pipeline value"
          value={formatMoney(overview?.pipelineValue ?? 0)}
          icon={<Banknote className="h-5 w-5" />}
        />
        <StatCard
          label="Opportunities"
          value={String(overview?.opportunities ?? 0)}
          icon={<Compass className="h-5 w-5" />}
        />
        <StatCard
          label="High priority (≥60)"
          value={String(overview?.highPriorityOpportunities ?? 0)}
          icon={<Star className="h-5 w-5" />}
        />
        <StatCard
          label="Follow-ups due"
          value={String(overview?.followUpsDue ?? 0)}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Deals won"
          value={String(overview?.dealsWon ?? 0)}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Deals lost"
          value={String(overview?.dealsLost ?? 0)}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Leads"
          value={String(overview?.leads ?? 0)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Conversion rate"
          value={`${overview?.conversionRate ?? 0}%`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by stage</CardTitle>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {STAGE_ORDER.map((stage) => {
                  const count = overview.byStage[stage.key as keyof typeof overview.byStage] ?? 0;
                  const max = Math.max(
                    1,
                    ...STAGE_ORDER.map(
                      (s) => overview.byStage[s.key as keyof typeof overview.byStage] ?? 0,
                    ),
                  );
                  return (
                    <div key={stage.key} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 text-muted-foreground">{stage.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-neon-cyan"
                          style={{ width: `${(count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top opportunities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No scored opportunities yet. Discover or add some.
              </p>
            ) : (
              top.map((opportunity) => (
                <div
                  key={opportunity.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{opportunity.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {opportunity.company ?? 'Unknown company'} ·{' '}
                      {formatMoney(opportunity.estimatedBudget)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={opportunityTypeVariant(opportunity.type)}>
                      {opportunity.type.replaceAll('_', ' ')}
                    </Badge>
                    <Badge>{opportunity.score}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <Link href="/dashboard/sales/opportunities">
              <Button variant="outline" className="w-full">
                <Compass className="h-4 w-4" /> Opportunities
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Link href="/dashboard/sales/discovery">
              <Button variant="outline" className="w-full">
                <Compass className="h-4 w-4" /> Discover
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Link href="/dashboard/sales/offers">
              <Button variant="outline" className="w-full">
                <FileText className="h-4 w-4" /> Offers
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Link href="/dashboard/sales/intelligence">
              <Button variant="outline" className="w-full">
                <TrendingUp className="h-4 w-4" /> Intelligence
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
