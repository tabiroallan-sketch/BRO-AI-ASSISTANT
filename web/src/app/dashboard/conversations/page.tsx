'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, MessageSquare } from 'lucide-react';
import { DashboardPageHeader } from '@/components/dashboard-page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { listConversations, type Conversation } from '@/lib/chat';

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function ConversationsPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setConversations(await listConversations());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load conversations.');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <DashboardPageHeader title="Conversations" description="Your chat history with BRO." />

      <div className="mb-4 flex justify-end">
        <Button asChild size="sm">
          <Link href="/chat">New chat</Link>
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {conversations === null ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No conversations yet. Start chatting to see history here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {conversation.title ?? 'Untitled conversation'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(conversation.updatedAt)}
                  </p>
                </div>
              </div>
              <p className="shrink-0 text-sm text-muted-foreground">
                {conversation.messageCount} message
                {conversation.messageCount === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
