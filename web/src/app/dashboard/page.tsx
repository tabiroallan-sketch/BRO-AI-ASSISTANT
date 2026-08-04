'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Box,
  Brain,
  Link2,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Wrench,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { ActivityChart } from '@/components/activity-chart';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  getAnalytics,
  getAutomations,
  listPlugins,
  listTools,
  type AnalyticsResponse,
  type AutomationsResponse,
} from '@/lib/dashboard';

type OverviewData = {
  analytics: AnalyticsResponse;
  automations: AutomationsResponse;
  toolCount: number;
  pluginCount: number;
};

function StatCard({
  icon: Icon,
  title,
  value,
  hint,
  href,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  hint: string;
  href: string;
}): React.JSX.Element {
  return (
    <Link href={href} className="block h-full">
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardOverviewPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [analytics, automations, tools, plugins] = await Promise.all([
        getAnalytics(),
        getAutomations(),
        listTools(),
        listPlugins(),
      ]);
      setData({ analytics, automations, toolCount: tools.length, pluginCount: plugins.length });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <DashboardPageHeader title="Dashboard" />
        <p className="text-sm text-destructive">{error ?? 'No data available.'}</p>
      </div>
    );
  }

  const { analytics, automations, toolCount, pluginCount } = data;
  const automationValue = automations.enabled ? String(automations.workflows.length) : 'Off';

  return (
    <div>
      <DashboardPageHeader
        title="Dashboard"
        description="An overview of your assistant, its conversations, accounts and automations."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={MessageSquare}
          title="Conversations"
          value={String(analytics.totals.conversations)}
          hint="View conversation history"
          href="/dashboard/conversations"
        />
        <StatCard
          icon={MessagesSquare}
          title="Messages"
          value={String(analytics.totals.messages)}
          hint="Total messages exchanged"
          href="/dashboard/analytics"
        />
        <StatCard
          icon={Brain}
          title="Memories"
          value={String(analytics.totals.memories)}
          hint="Facts BRO remembers"
          href="/dashboard/memories"
        />
        <StatCard
          icon={Link2}
          title="Connected accounts"
          value={String(analytics.totals.integrations)}
          hint="Third-party services linked"
          href="/dashboard/accounts"
        />
        <StatCard
          icon={Wrench}
          title="Installed tools"
          value={String(toolCount)}
          hint="Capabilities available to BRO"
          href="/dashboard/tools"
        />
        <StatCard
          icon={Box}
          title="Plugins"
          value={String(pluginCount)}
          hint="Extensions installed from the plugins directory"
          href="/dashboard/plugins"
        />
        <StatCard
          icon={Workflow}
          title="Automations"
          value={automationValue}
          hint={automations.enabled ? 'n8n workflows monitored' : 'n8n not configured'}
          href="/dashboard/automations"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.daily.every((day) => day.count === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No messages in the last 14 days. Start a chat to see activity here.
            </p>
          ) : (
            <ActivityChart daily={analytics.daily} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
