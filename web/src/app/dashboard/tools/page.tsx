'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Wrench } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { listTools, type ToolInfo } from '@/lib/dashboard';

export default function ToolsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [tools, setTools] = React.useState<ToolInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setTools(await listTools());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load installed tools.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <DashboardPageHeader
        title="Installed tools"
        description="Capabilities BRO can use to complete tasks in chat."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {tools === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <Card key={tool.name}>
              <CardContent className="flex items-start gap-3 p-4">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm font-medium">{tool.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
