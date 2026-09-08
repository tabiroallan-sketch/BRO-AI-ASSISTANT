'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Globe,
  KeyRound,
  Loader2,
  MessagesSquare,
  PlugZap,
  RefreshCw,
  Satellite,
  Search,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fetchLeadProviderHealth, type LeadProviderHealth } from '@/lib/lead-finder';
import { cn } from '@/lib/utils';

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  google_maps:
    'Google Maps / Places API. Best for local businesses with ratings, reviews, and contact data.',
  linkedin:
    'LinkedIn public company data via SerpAPI. Good for B2B companies and decision-making context.',
  indeed:
    'Indeed job listings. Detects hiring velocity and opens the door for recruitment agencies.',
  reddit:
    'Reddit search. Surfaces pain-point discussions and intent signals, public no-key access.',
  web: 'General web search via SerpAPI. Broad discovery and company website enrichment.',
};

const PROVIDER_ICONS: Record<string, typeof Search> = {
  google_maps: Search,
  linkedin: MessagesSquare,
  indeed: CheckCircle2,
  reddit: MessagesSquare,
  web: Globe,
};

function statusVariant(
  status: LeadProviderHealth['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected':
      return 'default';
    case 'degraded':
      return 'secondary';
    case 'not_configured':
      return 'outline';
    case 'error':
      return 'destructive';
  }
}

function statusLabel(status: LeadProviderHealth['status']): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'not_configured':
      return 'Not configured';
    case 'degraded':
      return 'Degraded';
    case 'error':
      return 'Error';
  }
}

function formatLatency(ms?: number): string {
  return ms === undefined ? '—' : `${ms} ms`;
}

export default function LeadSourcesPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const reduceMotion = useReducedMotion();

  const [providers, setProviders] = React.useState<LeadProviderHealth[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const list = await fetchLeadProviderHealth();
      setProviders(list);
      setLastRefresh(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load lead provider status.');
    } finally {
      setLoading(false);
    }
  }, [logout, router]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const connected = providers.filter((provider) => provider.status === 'connected').length;
  const errorCount = providers.filter((provider) => provider.status === 'error').length;
  const notConfigured = providers.filter((provider) => provider.status === 'not_configured').length;

  const stats = [
    {
      label: 'Configured / connected',
      value: String(connected),
      icon: PlugZap,
      tone: 'text-neon-cyan',
    },
    {
      label: 'Not configured',
      value: String(notConfigured),
      icon: KeyRound,
      tone: 'text-amber-500',
    },
    { label: 'Errors', value: String(errorCount), icon: TriangleAlert, tone: 'text-destructive' },
    {
      label: 'Providers',
      value: String(providers.length),
      icon: Satellite,
      tone: 'text-muted-foreground',
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live health of every lead discovery provider. Configure API keys in Settings →
            Integrations; keys are stored securely and can be updated without restarting BRO.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && providers.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-24 rounded-xl" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <>
          <motion.div
            variants={{ show: { transition: { staggerChildren: 0.06 } } }}
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {stats.map((stat) => (
              <motion.div
                key={stat.label}
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { type: 'spring', stiffness: 260, damping: 24 },
                  },
                }}
              >
                <Card className="h-full">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="rounded-xl bg-accent/60 p-2.5">
                      <stat.icon className={cn('h-5 w-5', stat.tone)} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold leading-none">{stat.value}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {lastRefresh && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Last check: {lastRefresh.toLocaleTimeString()}
            </p>
          )}

          <div className="mt-4 space-y-3">
            {providers.map((provider) => {
              const Icon = PROVIDER_ICONS[provider.providerId] ?? Satellite;
              const configured = provider.status !== 'not_configured';
              return (
                <motion.div
                  key={provider.providerId}
                  initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                >
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/60">
                            <Icon className="h-5 w-5 text-neon-cyan" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{provider.label}</span>
                              <Badge variant={statusVariant(provider.status)}>
                                {provider.status === 'connected' && (
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                )}
                                {provider.status === 'error' && (
                                  <XCircle className="mr-1 h-3 w-3" />
                                )}
                                {statusLabel(provider.status)}
                              </Badge>
                            </div>
                            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                              {PROVIDER_DESCRIPTIONS[provider.providerId] ??
                                provider.label + ' lead discovery source.'}
                            </p>
                            {provider.message && (
                              <p
                                className={cn(
                                  'mt-1 text-xs',
                                  provider.status === 'error'
                                    ? 'text-destructive'
                                    : provider.status === 'not_configured'
                                      ? 'text-muted-foreground'
                                      : 'text-emerald-600 dark:text-emerald-400',
                                )}
                              >
                                {provider.message}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-4">
                          <div className="text-right">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Latency
                            </p>
                            <p className="text-sm font-medium">
                              {formatLatency(provider.latencyMs)}
                            </p>
                          </div>
                          <Button
                            variant={configured ? 'outline' : 'default'}
                            size="sm"
                            asChild
                            disabled={loading}
                          >
                            <Link href="/settings/integrations">
                              <KeyRound className="mr-2 h-4 w-4" />
                              {configured ? 'Manage' : 'Configure'}
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {providers.length === 0 && !loading ? (
            <div className="mt-6 flex flex-col items-center gap-2 py-16 text-center">
              <XCircle className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No lead providers registered.</p>
            </div>
          ) : null}

          {loading && providers.length > 0 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Refreshing…
            </div>
          )}

          {user?.role === 'ADMIN' ? (
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-accent/60 bg-accent/30 px-3 py-2 text-xs text-muted-foreground">
              <KeyRound className="h-4 w-4 shrink-0 text-neon-cyan" />
              Credentials are stored encrypted and used at runtime. Save your API keys from Settings
              → Integrations; the health check above updates immediately after saving.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
