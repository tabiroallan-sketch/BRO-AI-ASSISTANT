'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Box, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { listPlugins, reloadPlugins, type PluginInfo } from '@/lib/dashboard';

export default function PluginsPage(): React.JSX.Element {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [plugins, setPlugins] = React.useState<PluginInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloading, setReloading] = React.useState(false);

  async function load(): Promise<void> {
    try {
      setPlugins(await listPlugins());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load plugins.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReload(): Promise<void> {
    setReloading(true);
    setError(null);
    try {
      const result = await reloadPlugins();
      await load();
      if (result.failed > 0) {
        setError(
          `${result.failed} plugin${result.failed === 1 ? '' : 's'} failed to load. See server logs.`,
        );
      } else if (result.loaded.length > 0) {
        setError(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to reload plugins.');
    } finally {
      setReloading(false);
    }
  }

  return (
    <div>
      <DashboardPageHeader
        title="Plugins"
        description="Extend BRO with tools installed from the plugins directory."
      />

      <div className="mb-4 flex items-center justify-between">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {user?.role === 'ADMIN' && (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleReload()}
              disabled={reloading}
            >
              {reloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reload plugins
            </Button>
          </div>
        )}
      </div>

      {plugins === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No plugins installed. Drop a plugin folder into the plugins directory and reload.
        </p>
      ) : (
        <div className="grid gap-3">
          {plugins.map((plugin) => (
            <Card key={plugin.name}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Box className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-all font-mono text-sm font-medium">{plugin.name}</p>
                        <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                      </div>
                      {plugin.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{plugin.description}</p>
                      )}
                      {plugin.author && (
                        <p className="mt-1 text-xs text-muted-foreground">by {plugin.author}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant={plugin.state === 'error' ? 'destructive' : 'secondary'}>
                    {plugin.state === 'error' ? 'error' : 'loaded'}
                  </Badge>
                </div>

                {plugin.state === 'error' && plugin.error && (
                  <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {plugin.error}
                  </p>
                )}

                {plugin.tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plugin.tools.map((tool) => (
                      <code
                        key={tool}
                        className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                      >
                        {tool}
                      </code>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
