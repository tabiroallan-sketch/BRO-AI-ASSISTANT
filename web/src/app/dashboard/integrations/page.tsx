'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BrainCircuit,
  Cloud,
  Columns3,
  Cpu,
  CreditCard,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  Github,
  Globe,
  Kanban,
  LayoutGrid,
  Loader2,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Send,
  ShoppingBag,
  Slack,
  Sparkles,
  SquareCheck,
  Star,
  Store,
  Table,
  Trash2,
  TrendingUp,
  Users,
  Video,
  Wind,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  connectUrl,
  fetchMarketplace,
  installMarketplaceItem,
  saveIntegration,
  uninstallMarketplaceItem,
  updateMarketplaceItem,
  type MarketplaceItem,
  type MarketplaceResponse,
} from '@/lib/integrations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const ITEM_META: Record<string, { icon: LucideIcon; gradient: string; glow: string }> = {
  google: { icon: Globe, gradient: 'from-sky-400 to-blue-600', glow: 'shadow-sky-500/40' },
  drive: { icon: Folder, gradient: 'from-amber-300 to-yellow-600', glow: 'shadow-amber-500/40' },
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
  dropbox: { icon: Cloud, gradient: 'from-blue-400 to-sky-600', glow: 'shadow-blue-500/40' },
  zoom: { icon: Video, gradient: 'from-cyan-400 to-blue-600', glow: 'shadow-cyan-500/40' },
  clickup: {
    icon: SquareCheck,
    gradient: 'from-rose-400 to-orange-500',
    glow: 'shadow-rose-500/40',
  },
  stripe: {
    icon: CreditCard,
    gradient: 'from-indigo-400 to-violet-600',
    glow: 'shadow-indigo-500/40',
  },
  openai: {
    icon: Sparkles,
    gradient: 'from-emerald-400 to-teal-600',
    glow: 'shadow-emerald-500/40',
  },
  nvidia: { icon: Cpu, gradient: 'from-lime-400 to-green-600', glow: 'shadow-lime-500/40' },
  gemini: { icon: Star, gradient: 'from-blue-400 to-violet-600', glow: 'shadow-blue-500/40' },
  anthropic: {
    icon: BrainCircuit,
    gradient: 'from-orange-400 to-amber-600',
    glow: 'shadow-orange-500/40',
  },
  trello: { icon: LayoutGrid, gradient: 'from-sky-400 to-blue-600', glow: 'shadow-sky-500/40' },
  asana: { icon: Columns3, gradient: 'from-rose-400 to-pink-600', glow: 'shadow-rose-500/40' },
  linear: {
    icon: TrendingUp,
    gradient: 'from-violet-400 to-purple-600',
    glow: 'shadow-violet-500/40',
  },
  jira: { icon: Kanban, gradient: 'from-blue-400 to-indigo-600', glow: 'shadow-blue-500/40' },
  shopify: {
    icon: ShoppingBag,
    gradient: 'from-emerald-400 to-green-600',
    glow: 'shadow-emerald-500/40',
  },
  salesforce: {
    icon: Wind,
    gradient: 'from-cyan-400 to-sky-600',
    glow: 'shadow-cyan-500/40',
  },
  hubspot: { icon: Users, gradient: 'from-orange-400 to-red-600', glow: 'shadow-orange-500/40' },
  airtable: {
    icon: Table,
    gradient: 'from-fuchsia-400 to-purple-600',
    glow: 'shadow-fuchsia-500/40',
  },
  telegram: { icon: Send, gradient: 'from-sky-400 to-cyan-600', glow: 'shadow-sky-500/40' },
  pipedrive: { icon: Filter, gradient: 'from-red-400 to-rose-600', glow: 'shadow-red-500/40' },
};

const FALLBACK_META: { icon: LucideIcon; gradient: string; glow: string } = {
  icon: Store,
  gradient: 'from-slate-400 to-slate-600',
  glow: 'shadow-slate-500/40',
};

function metaFor(item: MarketplaceItem) {
  return ITEM_META[item.icon] ?? FALLBACK_META;
}

function authLabel(item: MarketplaceItem): string {
  if (item.authType === 'oauth') {
    return 'OAuth';
  }
  if (item.authType === 'token') {
    return 'API key';
  }
  return 'Webhook';
}

function ItemCard({
  item,
  busy,
  onInstall,
  onUninstall,
  onUpdate,
  onConfigure,
  onConnect,
}: {
  item: MarketplaceItem;
  busy: string | null;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onUpdate: (item: MarketplaceItem) => void;
  onConfigure: (item: MarketplaceItem) => void;
  onConnect: (item: MarketplaceItem) => void;
}): React.JSX.Element {
  const meta = metaFor(item);
  const Icon = meta.icon;
  const installing = busy === `install:${item.id}`;
  const uninstalling = busy === `uninstall:${item.id}`;
  const updating = busy === `update:${item.id}`;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg',
              meta.gradient,
              meta.glow,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex items-center gap-2">
            {item.status === 'future' && <Badge variant="secondary">Roadmap</Badge>}
            {item.connected && <Badge variant="default">Connected</Badge>}
            {item.installed && !item.connected && <Badge variant="secondary">Installed</Badge>}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <p className="font-semibold">{item.name}</p>
          <span className="text-xs text-muted-foreground">v{item.version}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.category}</Badge>
          <Badge variant="outline">{authLabel(item)}</Badge>
        </div>

        {item.accountName && (
          <p className="mt-2 text-xs text-muted-foreground">Account: {item.accountName}</p>
        )}

        {!item.configured && item.authType === 'oauth' && (
          <p className="mt-2 text-xs text-destructive">
            Server OAuth credentials not configured for this provider.
          </p>
        )}

        {item.capabilities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.capabilities.slice(0, 4).map((capability) => (
              <code
                key={capability}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {capability}
              </code>
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {item.status === 'future' ? (
            <span className="text-xs text-muted-foreground">Coming soon</span>
          ) : !item.installed ? (
            <Button size="sm" onClick={() => onInstall(item)} disabled={busy !== null}>
              {installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Install
            </Button>
          ) : (
            <>
              {item.authType === 'oauth' ? (
                <Button
                  size="sm"
                  variant={item.connected ? 'outline' : 'default'}
                  onClick={() => onConnect(item)}
                  disabled={!item.configured || busy !== null}
                  title={!item.configured ? 'Server OAuth credentials not configured' : undefined}
                >
                  {item.connected ? 'Reconnect' : 'Connect'}
                  {item.configured ? <ArrowRight className="ml-1.5 h-3.5 w-3.5" /> : null}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={item.connected ? 'outline' : 'default'}
                  onClick={() => onConfigure(item)}
                  disabled={busy !== null}
                >
                  {item.connected ? 'Configure' : 'Connect'}
                </Button>
              )}
              {item.updateAvailable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate(item)}
                  disabled={busy !== null}
                >
                  {updating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Update
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onUninstall(item)}
                disabled={busy !== null}
                className="ml-auto text-muted-foreground hover:text-destructive"
              >
                {uninstalling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Uninstall
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  description,
  items,
  empty,
  ...handlers
}: {
  title: string;
  description: string;
  items: MarketplaceItem[];
  empty: string;
  busy: string | null;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onUpdate: (item: MarketplaceItem) => void;
  onConfigure: (item: MarketplaceItem) => void;
  onConnect: (item: MarketplaceItem) => void;
}): React.JSX.Element {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {empty}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} {...handlers} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function IntegrationsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [marketplace, setMarketplace] = React.useState<MarketplaceResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [configureTarget, setConfigureTarget] = React.useState<MarketplaceItem | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  async function load(): Promise<void> {
    try {
      setMarketplace(await fetchMarketplace());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load the integration marketplace.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInstall(item: MarketplaceItem): Promise<void> {
    setBusy(`install:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      await installMarketplaceItem(item.id);
      await load();
      if (item.authType === 'token') {
        setConfigureTarget(item);
        setDraft({});
      } else if (item.configured) {
        window.location.href = connectUrl(item.providerIds[0]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Install failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUninstall(item: MarketplaceItem): Promise<void> {
    if (!window.confirm(`Uninstall ${item.name}? Its connected accounts will be kept.`)) {
      return;
    }
    setBusy(`uninstall:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      await uninstallMarketplaceItem(item.id);
      await load();
      setNotice(`${item.name} uninstalled.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uninstall failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdate(item: MarketplaceItem): Promise<void> {
    setBusy(`update:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await updateMarketplaceItem(item.id);
      await load();
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  function handleConnect(item: MarketplaceItem): void {
    window.location.href = connectUrl(item.providerIds[0]);
  }

  function handleConfigure(item: MarketplaceItem): void {
    setConfigureTarget(item);
    setDraft({});
  }

  async function handleSave(): Promise<void> {
    if (!configureTarget) {
      return;
    }
    setBusy(`save:${configureTarget.id}`);
    setError(null);
    setNotice(null);
    try {
      await saveIntegration(configureTarget.providerIds[0], draft);
      setConfigureTarget(null);
      setDraft({});
      setNotice(`${configureTarget.name} connected.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the connection.');
    } finally {
      setBusy(null);
    }
  }

  const saving = busy === `save:${configureTarget?.id}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Integration Marketplace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse, install, and connect third-party services. Installed adapters are shared
          server-wide; connections are per user and managed in Settings.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <button
            type="button"
            className="text-destructive/70 hover:text-destructive"
            onClick={() => setError(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {marketplace === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Section
            title="Installed"
            description="Adapters enabled on this server. Connect accounts or manage them in Settings."
            items={marketplace.installed}
            empty="Nothing installed yet. Pick a provider below."
            busy={busy}
            onInstall={(item) => void handleInstall(item)}
            onUninstall={(item) => void handleUninstall(item)}
            onUpdate={(item) => void handleUpdate(item)}
            onConfigure={handleConfigure}
            onConnect={handleConnect}
          />

          <Section
            title="Available"
            description="Install an adapter to enable it for every user on this server."
            items={marketplace.available}
            empty="Every provider is installed."
            busy={busy}
            onInstall={(item) => void handleInstall(item)}
            onUninstall={(item) => void handleUninstall(item)}
            onUpdate={(item) => void handleUpdate(item)}
            onConfigure={handleConfigure}
            onConnect={handleConnect}
          />

          <Section
            title="Future"
            description="Providers on the roadmap. No adapter ships with this build yet."
            items={marketplace.future}
            empty="No roadmap items."
            busy={busy}
            onInstall={(item) => void handleInstall(item)}
            onUninstall={(item) => void handleUninstall(item)}
            onUpdate={(item) => void handleUpdate(item)}
            onConfigure={handleConfigure}
            onConnect={handleConnect}
          />
        </>
      )}

      {configureTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!saving) {
              setConfigureTarget(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Connect {configureTarget.name}</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfigureTarget(null)}
                disabled={saving}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{configureTarget.description}</p>

            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
            >
              {(configureTarget.fields ?? []).map((field) => (
                <div key={field.name} className="space-y-1.5">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <Input
                    id={field.name}
                    type={field.name.toLowerCase().includes('key') ? 'password' : 'text'}
                    placeholder={field.placeholder}
                    value={draft[field.name] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="accountName">Account name (optional)</Label>
                <Input
                  id="accountName"
                  placeholder="e.g. Production workspace"
                  value={draft.accountName ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, accountName: event.target.value }))
                  }
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfigureTarget(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save connection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end">
        <Button asChild variant="ghost" size="sm">
          <a href="/settings">
            Manage connections in Settings
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}
