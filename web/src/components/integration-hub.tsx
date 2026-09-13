'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  FileText,
  Folder,
  Gauge,
  Github,
  ListTodo,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Slack,
  Star,
  Table2,
  Trash2,
  Users,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  deleteAccount,
  disconnectIntegration,
  fetchHub,
  getIntegrationConnectUrl,
  listAccounts,
  reconnectIntegration,
  refreshIntegration,
  saveIntegration,
  setPrimaryAccount,
  syncHistory,
  testIntegration,
  type HubProvider,
  type IntegrationAccount,
  type SyncRecord,
} from '@/lib/integrations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const PROVIDER_META: Record<string, { icon: LucideIcon; gradient: string; glow: string }> = {
  'google-calendar': {
    icon: Calendar,
    gradient: 'from-sky-400 to-blue-600',
    glow: 'shadow-sky-500/40',
  },
  'google-gmail': { icon: Mail, gradient: 'from-rose-400 to-red-600', glow: 'shadow-rose-500/40' },
  'google-drive': {
    icon: Folder,
    gradient: 'from-amber-300 to-yellow-600',
    glow: 'shadow-amber-500/40',
  },
  'google-docs': {
    icon: BookOpen,
    gradient: 'from-blue-400 to-indigo-600',
    glow: 'shadow-blue-500/40',
  },
  'google-sheets': {
    icon: Table2,
    gradient: 'from-green-400 to-emerald-600',
    glow: 'shadow-green-500/40',
  },
  'google-tasks': {
    icon: ListTodo,
    gradient: 'from-lime-400 to-green-600',
    glow: 'shadow-lime-500/40',
  },
  'google-contacts': {
    icon: Users,
    gradient: 'from-teal-400 to-cyan-600',
    glow: 'shadow-teal-500/40',
  },
  github: { icon: Github, gradient: 'from-slate-400 to-slate-700', glow: 'shadow-slate-500/40' },
  slack: { icon: Slack, gradient: 'from-fuchsia-400 to-purple-600', glow: 'shadow-fuchsia-500/40' },
  discord: {
    icon: MessagesSquare,
    gradient: 'from-indigo-400 to-violet-600',
    glow: 'shadow-indigo-500/40',
  },
  notion: { icon: FileText, gradient: 'from-zinc-400 to-zinc-700', glow: 'shadow-zinc-500/40' },
  whatsapp: {
    icon: MessageCircle,
    gradient: 'from-emerald-400 to-green-600',
    glow: 'shadow-emerald-500/40',
  },
};

type Field = { name: string; label: string; placeholder: string; type?: 'text' | 'password' };

const CONFIG_FIELDS: Record<string, Field[]> = {
  discord: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/...',
    },
  ],
  whatsapp: [
    {
      name: 'token',
      label: 'Access token',
      placeholder: 'Permanent WhatsApp Business API token',
      type: 'password',
    },
    { name: 'phoneNumberId', label: 'Phone number ID', placeholder: 'e.g. 123456789012345' },
  ],
};

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString();
}

type StatusConfig = { label: string; className: string; dotClass: string; pulse?: boolean };

function statusConfig(status: HubProvider['status'], configured: boolean): StatusConfig {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        dotClass: 'bg-emerald-400',
        pulse: true,
      };
    case 'needs_refresh':
      return {
        label: 'Needs refresh',
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
        dotClass: 'bg-amber-400',
      };
    case 'expired':
      return {
        label: 'Expired',
        className: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
        dotClass: 'bg-orange-400',
      };
    case 'revoked':
      return {
        label: 'Revoked',
        className: 'border-red-500/30 bg-red-500/10 text-red-400',
        dotClass: 'bg-red-400',
      };
    case 'error':
      return {
        label: 'Error',
        className: 'border-red-500/30 bg-red-500/10 text-red-400',
        dotClass: 'bg-red-400',
      };
    default:
      return configured
        ? {
            label: 'Not connected',
            className: 'border-muted bg-muted/40 text-muted-foreground',
            dotClass: 'bg-muted-foreground',
          }
        : {
            label: 'Not configured',
            className: 'border-muted bg-muted/40 text-muted-foreground',
            dotClass: 'bg-muted-foreground',
          };
  }
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-background/40 px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function ProviderCard({
  provider,
  onReload,
  highlight,
}: {
  provider: HubProvider;
  onReload: () => Promise<void>;
  highlight?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const meta = PROVIDER_META[provider.id] ?? {
    icon: ExternalLink,
    gradient: 'from-cyan-400 to-blue-600',
    glow: 'shadow-cyan-500/40',
  };
  const Icon = meta.icon;
  const reduceMotion = useReducedMotion();

  const [expanded, setExpanded] = React.useState(false);
  const [accounts, setAccounts] = React.useState<IntegrationAccount[] | null>(null);
  const [syncs, setSyncs] = React.useState<SyncRecord[] | null>(null);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    latencyMs: number | null;
    message: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [newAccountKey, setNewAccountKey] = React.useState('');
  const [syncFlash, setSyncFlash] = React.useState(false);

  const connected = provider.connected;
  const status = statusConfig(provider.status, provider.configured);
  const enabledPermissions = provider.permissions.filter((permission) => permission.enabled);

  async function handleAuthFailure(err: unknown): Promise<boolean> {
    if (err instanceof ApiError && err.status === 401) {
      await logout();
      router.replace('/login');
      return true;
    }
    return false;
  }

  async function loadDetails(): Promise<void> {
    setDetailsLoading(true);
    try {
      const [accountList, history] = await Promise.all([
        listAccounts(provider.id),
        syncHistory(provider.id),
      ]);
      setAccounts(accountList);
      setSyncs(history);
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Failed to load details.');
      }
    } finally {
      setDetailsLoading(false);
    }
  }

  function toggleDetails(): void {
    const next = !expanded;
    setExpanded(next);
    setError(null);
    if (next && accounts === null && syncs === null) {
      void loadDetails();
    }
  }

  async function runTest(kind: 'test' | 'sync'): Promise<void> {
    setBusy(kind);
    setTestResult(null);
    setError(null);
    try {
      const result = await testIntegration(provider.id);
      setTestResult(result);
      if (kind === 'sync') {
        setNotice('Sync completed.');
        setSyncFlash(true);
        window.setTimeout(() => setSyncFlash(false), 1600);
      }
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Operation failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh(): Promise<void> {
    setBusy('refresh');
    setError(null);
    try {
      const result = await refreshIntegration(provider.id);
      setNotice(result.ok ? 'Access token refreshed.' : (result.message ?? 'Refresh failed.'));
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Refresh failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleReconnect(accountKey?: string): Promise<void> {
    setBusy('reconnect');
    setError(null);
    try {
      const result = await reconnectIntegration(provider.id, accountKey);
      window.location.href = result.url;
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Reconnect failed.');
      }
      setBusy(null);
    }
  }

  async function handleConnect(): Promise<void> {
    setBusy('connect');
    setError(null);
    try {
      const url = await getIntegrationConnectUrl(provider.id);
      window.location.href = url;
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Connect failed.');
      }
      setBusy(null);
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!window.confirm(`Disconnect ${provider.label}?`)) {
      return;
    }
    setBusy('disconnect');
    setError(null);
    try {
      await disconnectIntegration(provider.id);
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Disconnect failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(): Promise<void> {
    setBusy('save');
    setError(null);
    try {
      await saveIntegration(provider.id, draft);
      setDraft({});
      setNotice('Connection saved.');
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Save failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handlePromote(accountId: string): Promise<void> {
    setError(null);
    try {
      await setPrimaryAccount(provider.id, accountId);
      setAccounts(await listAccounts(provider.id));
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Failed to promote account.');
      }
    }
  }

  async function handleRemoveAccount(accountId: string): Promise<void> {
    if (!window.confirm('Remove this account?')) {
      return;
    }
    setError(null);
    try {
      await deleteAccount(provider.id, accountId);
      setAccounts(await listAccounts(provider.id));
      await onReload();
    } catch (err) {
      if (!(await handleAuthFailure(err))) {
        setError(err instanceof ApiError ? err.message : 'Failed to remove account.');
      }
    }
  }

  const lastSync = provider.lastSync;
  const health = provider.health;

  const stats: { icon: LucideIcon; label: string; value: string; sub: string }[] = [
    {
      icon: Zap,
      label: 'Last sync',
      value: lastSync ? formatRelative(lastSync.finishedAt ?? lastSync.startedAt) : 'Never',
      sub: lastSync
        ? lastSync.status === 'SUCCESS'
          ? `${lastSync.itemCount ?? 0} items synced`
          : `${lastSync.status.toLowerCase()}`
        : connected
          ? 'Run a sync to begin'
          : 'No connection',
    },
    {
      icon: Gauge,
      label: 'Latency',
      value: health?.latencyMs != null ? `${health.latencyMs} ms` : '—',
      sub: health
        ? `checked ${formatRelative(health.lastHealthCheckAt)}`
        : connected
          ? 'No check yet'
          : '—',
    },
    {
      icon: Activity,
      label: 'Health',
      value: health ? (health.ok ? 'Healthy' : 'Degraded') : connected ? 'Untested' : '—',
      sub: health?.lastMessage ?? (connected ? 'Run a health check' : '—'),
    },
  ];

  const shownPermissions = enabledPermissions.slice(0, 4);
  const hiddenPermissionCount = enabledPermissions.length - shownPermissions.length;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 24 } },
      }}
      initial={reduceMotion ? false : 'hidden'}
      animate="show"
      className={cn(
        'glass glass-hover relative overflow-hidden rounded-2xl p-5 transition-shadow duration-300',
        syncFlash && 'glow-success',
        busy === 'disconnect' && 'opacity-60 saturate-50',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan to-transparent',
          connected ? 'opacity-100' : 'opacity-30',
        )}
      />

      {(busy === 'sync' || busy === 'test') && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-neon-cyan/25 to-transparent" />
        </div>
      )}
      {busy === 'disconnect' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-destructive/35 to-transparent" />
        </div>
      )}
      {highlight && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute inset-0 animate-pulse-ring rounded-2xl border-2 border-emerald-400/60" />
        </div>
      )}
      {highlight && connected && (
        <div className="absolute right-4 top-4 z-10 animate-pop-in rounded-full bg-emerald-500/20 p-1.5 backdrop-blur-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="relative shrink-0">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg',
                meta.gradient,
                meta.glow,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            {connected && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{provider.label}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {provider.description}
            </p>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status.label}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              status.className,
            )}
          >
            <span className="relative flex h-2 w-2">
              {status.pulse && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              )}
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', status.dotClass)} />
            </span>
            {status.label}
          </motion.span>
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {connected && (
          <motion.div
            key="account-strip"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background/40 px-3 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-medium text-foreground">
                  {provider.accountName ?? provider.accountKey ?? 'Connected'}
                </span>
              </span>
              {provider.accountKey && (
                <span className="font-mono text-muted-foreground">{provider.accountKey}</span>
              )}
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                connected {formatRelative(provider.connectedAt)}
              </span>
              {provider.accountCount > 1 && (
                <span className="text-muted-foreground">{provider.accountCount} accounts</span>
              )}
              {provider.refreshCount > 0 && (
                <span className="text-muted-foreground">{provider.refreshCount} refreshes</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {provider.status === 'revoked' && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {provider.revokedReason ?? 'This connection was revoked.'} Reconnect to restore access.
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <StatTile key={stat.label} {...stat} />
        ))}
      </div>

      {(provider.type === 'webhook' || provider.type === 'token') && !connected && (
        <form
          className="mt-4 space-y-2 rounded-xl border bg-background/40 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          {(provider.fields ?? CONFIG_FIELDS[provider.id] ?? []).map((field) => (
            <div key={field.name} className="flex flex-col gap-1">
              <Label htmlFor={`${provider.id}-${field.name}`}>{field.label}</Label>
              <Input
                id={`${provider.id}-${field.name}`}
                type={
                  field.type ?? (field.name.toLowerCase().includes('key') ? 'password' : 'text')
                }
                placeholder={field.placeholder}
                value={draft[field.name] ?? ''}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            </div>
          ))}
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
            Save connection
          </Button>
        </form>
      )}

      {enabledPermissions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {shownPermissions.map((permission) => (
            <span
              key={permission.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              {permission.label}
            </span>
          ))}
          {hiddenPermissionCount > 0 && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              +{hiddenPermissionCount} more
            </span>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {notice && <p className="mt-3 text-xs text-emerald-400">{notice}</p>}
      {testResult && (
        <p className={cn('mt-3 text-xs', testResult.ok ? 'text-emerald-400' : 'text-red-400')}>
          {testResult.ok
            ? `Healthy · ${testResult.latencyMs ?? '?'} ms`
            : `Failed: ${testResult.message}`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={toggleDetails}>
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Hide details' : 'Details'}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runTest('sync')}
                disabled={busy !== null}
              >
                {busy === 'sync' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runTest('test')}
                disabled={busy !== null}
              >
                {busy === 'test' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4" />
                )}
                Test
              </Button>
              {provider.type === 'oauth' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleReconnect()}
                  disabled={busy !== null}
                >
                  {busy === 'reconnect' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Reconnect
                </Button>
              )}
              {(provider.status === 'needs_refresh' || provider.status === 'expired') &&
                provider.type === 'oauth' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRefresh()}
                    disabled={busy !== null}
                  >
                    {busy === 'refresh' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Refresh
                  </Button>
                )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDisconnect()}
                disabled={busy !== null}
                className="text-red-400 hover:text-red-400"
              >
                {busy === 'disconnect' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Disconnect
              </Button>
            </>
          )}
          {!connected && provider.type === 'oauth' && provider.configured && (
            <Button size="sm" onClick={() => void handleConnect()} disabled={busy !== null}>
              {busy === 'connect' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              Connect
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-5 border-t pt-4">
              <div className="space-y-2">
                <SectionHeader icon={Activity} title="Health" hint="Last check results" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border bg-background/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {health ? (health.ok ? 'Healthy' : 'Degraded') : 'Untested'}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Checked
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {health ? formatRelative(health.lastHealthCheckAt) : 'Never'}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Last success
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {health?.lastSuccessAt ? formatRelative(health.lastSuccessAt) : '—'}
                    </p>
                  </div>
                </div>
                {health?.lastMessage && (
                  <p className="rounded-lg border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                    {health.lastMessage}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <SectionHeader
                  icon={ShieldCheck}
                  title="Permissions"
                  hint={provider.scopes ? `scopes: ${provider.scopes}` : 'available permissions'}
                />
                <div className="space-y-1.5">
                  {provider.permissions.map((permission) => (
                    <div
                      key={permission.id}
                      className="flex items-start gap-2 rounded-lg border bg-background/40 px-3 py-2"
                    >
                      {permission.enabled ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{permission.label}</p>
                        <p className="text-xs text-muted-foreground">{permission.description}</p>
                      </div>
                      {permission.enabled && (
                        <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                          Granted
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
                {connected && (
                  <p className="text-[11px] text-muted-foreground">
                    Permissions are granted via OAuth scopes. Reconnect to change them.
                  </p>
                )}
              </div>

              {connected && (
                <div className="space-y-2">
                  <SectionHeader
                    icon={Users}
                    title="Accounts"
                    hint={
                      provider.accountCount > 1 ? `${provider.accountCount} connected` : '1 account'
                    }
                  />
                  {detailsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
                    </div>
                  ) : accounts ? (
                    <>
                      <div className="space-y-1.5">
                        {accounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/40 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-sm font-medium">
                                <span className="truncate">
                                  {account.accountName ?? account.accountKey}
                                </span>
                                {account.isPrimary && (
                                  <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                                )}
                              </p>
                              <p className="truncate font-mono text-[11px] text-muted-foreground">
                                {account.accountKey} · {account.status}
                              </p>
                            </div>
                            {!account.isPrimary && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handlePromote(account.id)}
                                disabled={busy !== null}
                              >
                                Make primary
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleRemoveAccount(account.id)}
                              disabled={busy !== null}
                              className="text-red-400 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      {provider.type === 'oauth' && provider.configured && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Input
                            placeholder="Account label, e.g. work"
                            value={newAccountKey}
                            onChange={(event) => setNewAccountKey(event.target.value)}
                            className="max-w-56"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleReconnect(newAccountKey.trim())}
                            disabled={busy !== null || newAccountKey.trim() === ''}
                          >
                            <Plug className="h-4 w-4" />
                            Add account
                          </Button>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}

              <div className="space-y-2">
                <SectionHeader icon={Zap} title="Sync activity" hint="Recent health syncs" />
                {detailsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading sync history…
                  </div>
                ) : syncs && syncs.length > 0 ? (
                  <div className="space-y-1.5">
                    {syncs.map((sync) => (
                      <div key={sync.id} className="flex items-center gap-2 text-sm">
                        {sync.status === 'RUNNING' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-neon-cyan" />
                        ) : sync.status === 'SUCCESS' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400" />
                        )}
                        <span className="font-medium capitalize">{sync.kind} sync</span>
                        <span className="text-muted-foreground">
                          {formatRelative(sync.finishedAt ?? sync.startedAt)}
                        </span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">
                          {sync.status === 'SUCCESS'
                            ? `${sync.itemCount ?? 0} items`
                            : sync.status.toLowerCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No syncs recorded yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function IntegrationHub(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const reduceMotion = useReducedMotion();
  const [providers, setProviders] = React.useState<HubProvider[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [highlightProvider, setHighlightProvider] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setProviders(await fetchHub());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load the integration hub.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration');
    const status = params.get('status');
    if (provider && status === 'connected') {
      setNotice(`${provider} connected successfully.`);
      setHighlightProvider(provider);
      window.history.replaceState({}, '', window.location.pathname);
      void load();
      const timer = window.setTimeout(() => setHighlightProvider(null), 5000);
      return () => window.clearTimeout(timer);
    } else if (provider && status === 'error') {
      const reason = params.get('reason');
      setError(reason ? `Connection failed: ${reason}` : 'Connection failed.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedCount = providers?.filter((provider) => provider.connected).length ?? 0;
  const healthyCount =
    providers?.filter((provider) => provider.connected && provider.health?.ok).length ?? 0;
  const degradedCount = connectedCount - healthyCount;

  return (
    <section>
      <div className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              Integration <span className="neon-text">Hub</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect third-party services so BRO can read and send data on your behalf.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {connectedCount} connected
            </span>
            {connectedCount > 0 && (
              <span
                className={cn(
                  'glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs',
                  degradedCount > 0 ? 'text-amber-400' : 'text-emerald-400',
                )}
              >
                {degradedCount > 0 ? `${degradedCount} degraded` : `${healthyCount} healthy`}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {providers === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="glass rounded-2xl p-5"
              aria-hidden="true"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="flex items-start gap-3">
                <div className="skeleton h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-32 rounded-md" />
                  <div className="skeleton h-3 w-48 rounded-md" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="skeleton h-14 rounded-xl" />
                <div className="skeleton h-14 rounded-xl" />
                <div className="skeleton h-14 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <motion.div
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          initial={reduceMotion ? false : 'hidden'}
          animate="show"
          className="grid gap-4 lg:grid-cols-2"
        >
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onReload={load}
              highlight={highlightProvider === provider.id}
            />
          ))}
        </motion.div>
      )}
    </section>
  );
}
