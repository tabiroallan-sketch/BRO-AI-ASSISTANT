'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Loader2, MessagesSquare } from 'lucide-react';
import { ActivityChart } from '@/components/activity-chart';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getAnalytics, type AnalyticsResponse } from '@/lib/dashboard';

function MetricCard({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [data, setData] = React.useState<AnalyticsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setData(await getAnalytics());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load analytics.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { totals, messagesByRole, daily } = data;
  const totalMessages = totals.messages;

  return (
    <div>
      <DashboardPageHeader title="Analytics" description="Usage statistics for your assistant." />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Conversations" value={totals.conversations} />
        <MetricCard label="Messages" value={totalMessages} />
        <MetricCard label="Memories" value={totals.memories} />
        <MetricCard label="Connected accounts" value={totals.integrations} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessagesSquare className="h-4 w-4" />
              Messages by role
            </CardTitle>
            <CardDescription>How much you and BRO have said.</CardDescription>
          </CardHeader>
          <CardContent>
            {totalMessages === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>You</span>
                  <span className="font-medium">{messagesByRole.user}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${totalMessages === 0 ? 0 : (messagesByRole.user / totalMessages) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>BRO</span>
                  <span className="font-medium">{messagesByRole.assistant}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${totalMessages === 0 ? 0 : (messagesByRole.assistant / totalMessages) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Messages per day
            </CardTitle>
            <CardDescription>Last 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityChart daily={daily} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
