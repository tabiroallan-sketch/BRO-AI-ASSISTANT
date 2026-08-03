'use client';

import * as React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Conversation } from '@/lib/chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingValue, setEditingValue] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  function startRename(conversation: Conversation): void {
    setEditingId(conversation.id);
    setEditingValue(conversation.title ?? '');
  }

  async function commitRename(id: string): Promise<void> {
    const title = editingValue.trim();
    setEditingId(null);
    if (!title) {
      return;
    }
    setBusyId(id);
    try {
      await onRename(id, title);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusyId(id);
    try {
      await onDelete(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/30">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <Plus className="mr-2 h-4 w-4" />
          New chat
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            No conversations yet.
          </p>
        )}
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeId;
          return (
            <div
              key={conversation.id}
              className={cn(
                'group flex items-center gap-1 rounded-md px-2 py-2 text-sm transition-colors',
                isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              {editingId === conversation.id ? (
                <form
                  className="flex flex-1 items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void commitRename(conversation.id);
                  }}
                >
                  <Input
                    autoFocus
                    value={editingValue}
                    onChange={(event) => setEditingValue(event.target.value)}
                    onBlur={() => void commitRename(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                    className="h-7 py-0 text-xs"
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={conversation.title ?? 'Untitled'}
                  >
                    {conversation.title ?? 'Untitled'}
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={busyId === conversation.id}
                      aria-label="Rename conversation"
                      onClick={() => startRename(conversation)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      disabled={busyId === conversation.id}
                      aria-label="Delete conversation"
                      onClick={() => void remove(conversation.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
