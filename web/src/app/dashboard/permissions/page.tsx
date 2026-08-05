'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Calendar,
  ExternalLink,
  FileText,
  Folder,
  Github,
  ListTodo,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Slack,
  Table2,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  listPermissions,
  updatePermissions,
  type PermissionCenterProvider,
} from '@/lib/integrations';
import { cn } from '@/lib/utils';

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  'google-calendar': Calendar,
  'google-gmail': Mail,
  'google-drive': Folder,
  'google-docs': BookOpen,
  'google-sheets': Table2,
  'google-tasks': ListTodo,
  'google-contacts': Users,
  github: Github,
  slack: Slack,
  discord: MessagesSquare,
  notion: FileText,
  whatsapp: MessageCircle,
};

function formatCount(count: number): string {
  return count.toLocaleString();
}

function PermissionSwitch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200',
        checked ? 'border-neon-cyan/50 bg-neon-cyan/25' : 'border-border bg-muted',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full shadow transition-transform duration-200',
          checked ? 'translate-x-[18px] bg-neon-cyan' : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  );
}

function PermissionRow({
  permission,
  provider,
  busy,
  onToggle,
}: {
  permission: PermissionCenterProvider['permissions'][number];
  provider: PermissionCenterProvider;
  busy: boolean;
  onToggle: (permissionId: string, next: boolean) => void;
}): React.JSX.Element {
  const canToggle = provider.connected && permission.granted && !busy;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-2.5',
        permission.enabled
          ? 'border-neon-cyan/20 bg-neon-cyan/5'
          : 'border-border bg-background/40',
      )}
    >
      <PermissionSwitch
        checked={permission.enabled}
        disabled={!canToggle}
        onToggle={() => onToggle(permission.id, !permission.enabled)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{permission.label}</p>
          {permission.enabled ? (
            <Badge variant="outline" className="text-[10px] text-emerald-400">
              Enabled
            </Badge>
          ) : permission.granted ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Disabled
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-amber-400">
              Not granted
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{permission.description}</p>
        {provider.connected && !permission.granted && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400/80">
            <Lock className="h-3 w-3" /> Reconnect with the right scope to enable this permission.
          </p>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onToggle,
}: {
  provider: PermissionCenterProvider;
  busy: boolean;
  onToggle: (providerId: string, permissionId: string, next: boolean) => void;
}): React.JSX.Element {
  const Icon = PROVIDER_ICONS[provider.id] ?? ExternalLink;
  const enabledCount = provider.permissions.filter((permission) => permission.enabled).length;
  const grantedCount = provider.permissions.filter((permission) => permission.granted).length;

  return (
    <div className="glass glass-hover relative overflow-hidden rounded-2xl p-5">
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan to-transparent',
          provider.connected ? 'opacity-100' : 'opacity-30',
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-lg">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{provider.label}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {provider.description}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0',
            provider.connected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'text-muted-foreground',
          )}
        >
          {provider.connected
            ? 'Connected'
            : provider.configured
              ? 'Not connected'
              : 'Not configured'}
        </Badge>
      </div>

      {provider.connected && (
        <p className="mt-3 truncate text-xs text-muted-foreground">
          {provider.accountName ?? provider.accountKey ?? 'Connected account'}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all duration-300"
            style={{
              width: `${provider.permissions.length > 0 ? (enabledCount / provider.permissions.length) * 100 : 0}%`,
            }}
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {enabledCount} of {provider.permissions.length} enabled
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        {provider.permissions.map((permission) => (
          <PermissionRow
            key={permission.id}
            permission={permission}
            provider={provider}
            busy={busy}
            onToggle={(permissionId, next) => onToggle(provider.id, permissionId, next)}
          />
        ))}
      </div>

      {provider.connected && grantedCount < provider.permissions.length && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-[11px] text-muted-foreground">
            {provider.permissions.length - grantedCount} permission
            {provider.permissions.length - grantedCount === 1 ? '' : 's'} need a wider OAuth grant
          </p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">
              <RefreshCw className="h-3.5 w-3.5" />
              Reconnect
            </Link>
          </Button>
        </div>
      )}

      {!provider.connected && provider.configured && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" />
          Connect this provider from Settings to manage its permissions.
        </p>
      )}
    </div>
  );
}

export default function PermissionsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [providers, setProviders] = React.useState<PermissionCenterProvider[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setProviders(await listPermissions());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load permissions.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(providerId: string, permissionId: string, next: boolean): Promise<void> {
    const snapshot = providers?.find((provider) => provider.id === providerId) ?? null;
    if (!snapshot) {
      return;
    }
    const nextIds = snapshot.permissions
      .filter((permission) => (permission.id === permissionId ? next : permission.enabled))
      .map((permission) => permission.id);
    setProviders(
      (current) =>
        current?.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                permissions: provider.permissions.map((permission) =>
                  permission.id === permissionId ? { ...permission, enabled: next } : permission,
                ),
              }
            : provider,
        ) ?? current,
    );
    setBusy(providerId);
    setError(null);
    try {
      const updated = await updatePermissions(providerId, nextIds);
      setProviders(
        (current) =>
          current?.map((provider) => (provider.id === providerId ? updated : provider)) ?? current,
      );
      setNotice('Permissions updated.');
    } catch (err) {
      setProviders(
        (current) =>
          current?.map((provider) => (provider.id === providerId ? snapshot : provider)) ?? current,
      );
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to update permissions.');
    } finally {
      setBusy(null);
    }
  }

  const connectedCount = providers?.filter((provider) => provider.connected).length ?? 0;
  const grantedCount =
    providers?.reduce(
      (total, provider) =>
        total + provider.permissions.filter((permission) => permission.granted).length,
      0,
    ) ?? 0;
  const enabledCount =
    providers?.reduce(
      (total, provider) =>
        total + provider.permissions.filter((permission) => permission.enabled).length,
      0,
    ) ?? 0;

  return (
    <div>
      <DashboardPageHeader
        title="Permission Center"
        description="Review every capability BRO can use and choose which ones stay enabled."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
          <Zap className="h-3.5 w-3.5 text-neon-cyan" />
          {connectedCount} providers connected
        </span>
        <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
          <Lock className="h-3.5 w-3.5 text-amber-400" />
          {formatCount(grantedCount)} permissions granted
        </span>
        <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {formatCount(enabledCount)} enabled
        </span>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href="/settings">
            Manage connections
            <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
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
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              busy={busy === provider.id}
              onToggle={(providerId, permissionId, next) =>
                void toggle(providerId, permissionId, next)
              }
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Disabling a permission stops BRO from using that capability even when the underlying account
        scope is still granted. To grant additional scopes, reconnect the provider from Settings and
        approve the requested permissions.
      </p>
    </div>
  );
}
