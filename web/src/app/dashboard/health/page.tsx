'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import {
  fetchHealth,
  runHealthProbe,
  setAutoReconnect,
  type HealthProvider,
  type HealthResponse,
} from '@/lib/integrations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type RowState = 'idle' | 'checking' | 'toggling';

function formatLatency(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

function statusBadge(provider: HealthProvider): React.JSX.Element {
  const health = provider.health;
  if (!provider.connected) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Disconnected
      </Badge>
    );
  }
  if (health?.ok === true || health?.issue === 'connected') {
    return (
      <Badge className="border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        Connected
      </Badge>
    );
  }
  if (health && health.issueLabel) {
    const tone =
      health.issue === 'rate_limited'
        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : health.issue === 'expired' || health.issue === 'invalid_credentials'
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    return <Badge className={tone}>{health.issueLabel}</Badge>;
  }
  if (provider.revokedAt) {
    return (
      <Badge className="border-destructive/50 bg-destructive/10 text-destructive">Revoked</Badge>
    );
  }
  return (
    <Badge className="border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      Connected
    </Badge>
  );
}

export default function HealthPage(): React.JSX.Element {
  const [data, setData] = React.useState<HealthResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rowState, setRowState] = React.useState<Record<string, RowState>>({});
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);
  const reduceMotion = useReducedMotion();

  async function load(): Promise<void> {
    setError(null);
    try {
      setData(await fetchHealth());
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load connection health.');
    }
  }

  React.useEffect(() => {
    void load();
  }, []);

  async function handleCheck(provider: HealthProvider): Promise<void> {
    setRowState((current) => ({ ...current, [provider.id]: 'checking' }));
    setError(null);
    try {
      await runHealthProbe(provider.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Health check failed.');
    } finally {
      setRowState((current) => ({ ...current, [provider.id]: 'idle' }));
    }
  }

  async function handleToggle(provider: HealthProvider, enabled: boolean): Promise<void> {
    setRowState((current) => ({ ...current, [provider.id]: 'toggling' }));
    setBusy(`reconnect:${provider.id}`);
    setError(null);
    try {
      await setAutoReconnect(provider.id, enabled);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update auto-reconnect.');
    } finally {
      setBusy(null);
      setRowState((current) => ({ ...current, [provider.id]: 'idle' }));
    }
  }

  const summary = data?.summary;
  const stats = [
    {
      label: 'Connected',
      value: summary?.connected ?? '—',
      icon: PlugZap,
      tone: 'text-neon-cyan',
    },
    {
      label: 'Healthy',
      value: summary?.healthy ?? '—',
      icon: CheckCircle2,
      tone: 'text-emerald-500',
    },
    {
      label: 'Unhealthy',
      value: summary?.unhealthy ?? '—',
      icon: TriangleAlert,
      tone: 'text-destructive',
    },
    {
      label: 'Auto-reconnect on',
      value: summary?.autoReconnectEnabled ?? '—',
      icon: Zap,
      tone: 'text-amber-500',
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connection Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live status, latency, quota, and last sync for every connected integration. The
            background monitor probes these automatically; auto-reconnect refreshes expired tokens
            without intervention.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={data === null}>
          <RefreshCw className={cn('mr-2 h-4 w-4', lastRefresh && 'group-hover:animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {data === null ? (
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

          <Card className="mt-6">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-neon-cyan" />
                  Monitor{' '}
                  <strong className="font-medium text-foreground">
                    {data.monitor.enabled ? 'running' : 'disabled'}
                  </strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-neon-cyan" />
                  Interval{' '}
                  <strong className="font-medium text-foreground">
                    {Math.round(data.monitor.intervalMs / 60000)} min
                  </strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-neon-cyan" />
                  Auto-reconnect{' '}
                  <strong className="font-medium text-foreground">
                    {data.monitor.autoReconnectEnabled ? 'enabled' : 'disabled'}
                  </strong>
                </span>
                {data.sweep && (
                  <span className="flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 text-neon-cyan" />
                    Last sweep: {data.sweep.checked} checked · {data.sweep.healthy} healthy ·{' '}
                    {data.sweep.unhealthy} unhealthy
                    {data.sweep.autoReconnected > 0 &&
                      ` · ${data.sweep.autoReconnected} reconnected`}
                    {data.sweep.disabled > 0 && ` · ${data.sweep.disabled} disabled`}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 space-y-3">
            {data.providers.map((provider) => {
              const health = provider.health;
              const state = rowState[provider.id] ?? 'idle';
              const quota = health?.quota;
              const badgeKey = `${provider.connected}-${health?.issue ?? 'none'}-${provider.revokedAt ?? 'none'}`;
              return (
                <motion.div
                  key={provider.id}
                  layout={reduceMotion ? false : true}
                  initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                >
                  <Card className="relative overflow-hidden">
                    {state === 'checking' && (
                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                        <div className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-neon-cyan/25 to-transparent" />
                      </div>
                    )}
                    <CardContent className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/60">
                            <Activity className="h-5 w-5 text-neon-cyan" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{provider.label}</span>
                              <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                  key={badgeKey}
                                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 4 }}
                                  transition={{ duration: 0.16 }}
                                >
                                  {statusBadge(provider)}
                                </motion.span>
                              </AnimatePresence>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {provider.connected
                                ? (provider.accountName ?? provider.id)
                                : 'Not connected'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleCheck(provider)}
                            disabled={!provider.connected || state !== 'idle'}
                          >
                            {state === 'checking' ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Run check
                          </Button>
                          {provider.connected && (
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[var(--neon-cyan)]"
                                checked={provider.autoReconnect}
                                disabled={state !== 'idle' || busy !== null}
                                onChange={(event) =>
                                  void handleToggle(provider, event.target.checked)
                                }
                              />
                              Auto-reconnect
                            </label>
                          )}
                        </div>
                      </div>

                      {provider.connected && (
                        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
                          <HealthStat
                            label="Latency"
                            value={formatLatency(health?.latencyMs ?? null)}
                          />
                          <HealthStat label="API status" value={health?.apiStatus ?? '—'} />
                          <HealthStat
                            label="Last checked"
                            value={formatDate(health?.lastHealthCheckAt ?? null)}
                          />
                          <HealthStat
                            label="Last sync"
                            value={formatDate(provider.lastSync?.finishedAt ?? null)}
                          />
                          <HealthStat
                            label="Token expiry"
                            value={formatDate(provider.tokenExpiresAt ?? null)}
                          />
                          <HealthStat
                            label="Quota"
                            value={
                              quota && (quota.used !== null || quota.limit !== null)
                                ? `${quota.remaining ?? '—'} / ${quota.limit ?? '—'} used ${quota.used ?? '—'}`
                                : '—'
                            }
                          />
                          <HealthStat label="Last message" value={health?.lastMessage ?? '—'} />
                          <HealthStat label="Error code" value={health?.code ?? '—'} />
                        </div>
                      )}

                      {provider.connected && health && !health.ok && (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          <span>
                            {health.lastMessage ?? 'Connection is unhealthy.'}
                            {health.issue === 'rate_limited' &&
                              ' The provider is throttling requests; the monitor will retry on the next sweep.'}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {data.providers.length === 0 && (
            <div className="mt-6 flex flex-col items-center gap-2 py-16 text-center">
              <XCircle className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No integrations available. Install providers from the Marketplace first.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HealthStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}
