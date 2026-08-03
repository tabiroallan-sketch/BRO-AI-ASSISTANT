import { Bot, Brain, MessageSquare, Mic, Settings2, Workflow } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const upcoming = [
  {
    icon: MessageSquare,
    title: 'AI Chat',
    description: 'Streaming conversations with your assistant.',
  },
  {
    icon: Brain,
    title: 'Memory',
    description: 'Long-term recall across conversations.',
  },
  {
    icon: Mic,
    title: 'Voice',
    description: 'Speak and listen to your assistant.',
  },
  {
    icon: Settings2,
    title: 'Tools',
    description: 'Calculator, web search, files and more.',
  },
  {
    icon: Workflow,
    title: 'Automation',
    description: 'Trigger and monitor n8n workflows.',
  },
  {
    icon: Bot,
    title: 'Plugins',
    description: 'Extend BRO with installable plugins.',
  },
];

export default function DashboardPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Welcome back. Your assistant is being built — here is what is coming next.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((feature) => (
            <Card key={feature.title}>
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <feature.icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </RequireAuth>
  );
}
