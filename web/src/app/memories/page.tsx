'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Brain, Pencil, Plus, Trash2 } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
  type Memory,
} from '@/lib/memories';

export default function MemoriesPage(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [memories, setMemories] = React.useState<Memory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [key, setKey] = React.useState('');
  const [value, setValue] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function loadMemories(): Promise<void> {
    try {
      setMemories(await listMemories());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load memories.');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(memory: Memory): void {
    setEditingId(memory.id);
    setKey(memory.key);
    setValue(memory.value);
    setCategory(memory.category ?? '');
  }

  function resetForm(): void {
    setEditingId(null);
    setKey('');
    setValue('');
    setCategory('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        await updateMemory(editingId, { value, ...(category ? { category } : {}) });
      } else {
        await createMemory({ key, value, ...(category ? { category } : {}) });
      }
      resetForm();
      await loadMemories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save memory.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setError(null);
    try {
      await deleteMemory(id);
      if (editingId === id) {
        resetForm();
      }
      await loadMemories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete memory.');
    }
  }

  return (
    <RequireAuth>
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Memories</h1>
          <p className="mt-1 text-muted-foreground">
            Facts BRO remembers about you and uses to personalize every conversation.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Edit memory' : 'Add a memory'}
              </CardTitle>
              <CardDescription>
                Keys are unique per account; saving an existing key updates its value.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="key">Key</Label>
                  <Input
                    id="key"
                    placeholder="e.g. name"
                    required
                    disabled={editingId !== null}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="value">Value</Label>
                  <Textarea
                    id="value"
                    placeholder="e.g. Alice, prefers short replies"
                    required
                    rows={3}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category (optional)</Label>
                  <Input
                    id="category"
                    placeholder="e.g. personal, work"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Save'}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Stored facts
              </CardTitle>
              <CardDescription>
                {loading
                  ? 'Loading…'
                  : `${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!loading && memories.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No memories yet. Add one to let BRO remember it.
                </p>
              )}
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className="flex items-start justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{memory.key}</span>
                      {memory.category && <Badge variant="secondary">{memory.category}</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {memory.value}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${memory.key}`}
                      onClick={() => startEdit(memory)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${memory.key}`}
                      onClick={() => void handleDelete(memory.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </RequireAuth>
  );
}
