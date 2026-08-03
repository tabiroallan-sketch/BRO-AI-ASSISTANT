'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2 } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { listIntegrations, type IntegrationInfo } from '@/lib/integrations';

export default function AccountsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [integrations, setIntegrations] = React.useState<IntegrationInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setIntegrations(await listIntegrations());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load connected accounts.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = integrations?.filter((integration) => integration.connected) ?? [];

  return (
    <div>
      <DashboardPageHeader
        title="Connected accounts"
        description="Third-party services linked to your assistant."
      />

      <div className="mb-4 flex justify-end">
        <Button asChild size="sm">
          <Link href="/settings">
            Manage in Settings
            <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {integrations === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : connected.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No accounts connected yet. Link one from Settings to let BRO read and send data on your
            behalf.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {connected.map((integration) => (
            <div
              key={integration.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{integration.label}</p>
                <p className="text-sm text-muted-foreground">
                  {integration.accountName ?? integration.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">Connected</Badge>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings">Manage</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
