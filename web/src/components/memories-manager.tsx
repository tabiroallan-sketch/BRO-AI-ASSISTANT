'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Brain, History, List, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MemoryTimeline } from '@/components/memory-timeline';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  MEMORY_KIND_LABELS,
  createMemory,
  deleteMemory,
  getMemorySummary,
  getMemoryTimeline,
  listMemories,
  updateMemory,
  type Memory,
  type MemoryKind,
  type MemoryTimelineGroup,
} from '@/lib/memories';

const KIND_OPTIONS: Array<{ value: MemoryKind; label: string }> = Object.entries(
  MEMORY_KIND_LABELS,
).map(([value, label]) => ({ value: value as MemoryKind, label }));

function daysSinceLastSeen(memory: Memory): number {
  const last = memory.lastAccessedAt ?? memory.updatedAt;
  const time = new Date(last).getTime();
  return Number.isNaN(time) ? 0 : Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

/** Mirrors the backend half-life (30 days): 1 = fresh, 0 = fully decayed. */
function memoryStrength(memory: Memory): number {
  return Math.max(0, Math.min(1, Math.pow(0.5, daysSinceLastSeen(memory) / 30)));
}

export function MemoriesManager(): React.JSX.Element {
  const router = useRouter();
  const { logout } = useAuth();
  const [memories, setMemories] = React.useState<Memory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [kindFilter, setKindFilter] = React.useState<MemoryKind | 'all'>('all');
  const [view, setView] = React.useState<'facts' | 'timeline'>('facts');
  const [timeline, setTimeline] = React.useState<MemoryTimelineGroup[]>([]);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [key, setKey] = React.useState('');
  const [value, setValue] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [kind, setKind] = React.useState<MemoryKind>('other');
  const [importance, setImportance] = React.useState('5');
  const [tags, setTags] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function loadMemories(options: { q?: string; kind?: MemoryKind } = {}): Promise<void> {
    try {
      setMemories(await listMemories(options));
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

  async function loadTimeline(): Promise<void> {
    try {
      setTimeline(await getMemoryTimeline());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load the memory timeline.');
    }
  }

  async function loadSummary(): Promise<void> {
    try {
      setSummary(await getMemorySummary());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setSummary(null);
    }
  }

  React.useEffect(() => {
    void loadMemories();
    void loadTimeline();
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      void loadMemories({
        q: search || undefined,
        kind: kindFilter === 'all' ? undefined : kindFilter,
      });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, kindFilter]);

  function startEdit(memory: Memory): void {
    setEditingId(memory.id);
    setKey(memory.key);
    setValue(memory.value);
    setCategory(memory.category ?? '');
    setKind(memory.kind);
    setImportance(String(memory.importance));
    setTags(memory.tags.join(', '));
  }

  async function openFromTimeline(memoryId: string): Promise<void> {
    setSearch('');
    setKindFilter('all');
    setView('facts');
    const known = memories.find((memory) => memory.id === memoryId);
    if (known) {
      startEdit(known);
      return;
    }
    try {
      const fresh = await listMemories();
      setMemories(fresh);
      const memory = fresh.find((candidate) => candidate.id === memoryId);
      if (memory) {
        startEdit(memory);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        router.replace('/login');
        return;
      }
      setError('Failed to load memories.');
    }
  }

  function resetForm(): void {
    setEditingId(null);
    setKey('');
    setValue('');
    setCategory('');
    setKind('other');
    setImportance('5');
    setTags('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const parsedImportance = Number.parseInt(importance, 10);
    const normalizedImportance = Number.isFinite(parsedImportance)
      ? Math.min(10, Math.max(1, parsedImportance))
      : 5;
    const parsedTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    try {
      if (editingId) {
        await updateMemory(editingId, {
          value,
          category: category || undefined,
          kind,
          importance: normalizedImportance,
          tags: parsedTags,
        });
      } else {
        await createMemory({
          key,
          value,
          category: category || undefined,
          kind,
          importance: normalizedImportance,
          tags: parsedTags,
        });
      }
      resetForm();
      await Promise.all([loadMemories(), loadTimeline()]);
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
      await Promise.all([loadMemories(), loadTimeline()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete memory.');
    }
  }

  return (
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="kind">Kind</Label>
                <select
                  id="kind"
                  className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as MemoryKind)}
                >
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="importance">Importance (1-10)</Label>
                <Input
                  id="importance"
                  type="number"
                  min={1}
                  max={10}
                  value={importance}
                  onChange={(event) => setImportance(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma separated, optional)</Label>
              <Input
                id="tags"
                placeholder="e.g. bro, roadmap"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
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

      <div className="space-y-4">
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
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search memories"
                  className="pl-8"
                  placeholder="Search memories…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <select
                aria-label="Filter by kind"
                className="flex h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as MemoryKind | 'all')}
              >
                <option value="all">All kinds</option>
                {KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex rounded-lg border p-0.5">
                <Button
                  type="button"
                  variant={view === 'facts' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('facts')}
                >
                  <List className="mr-1 h-4 w-4" />
                  Facts
                </Button>
                <Button
                  type="button"
                  variant={view === 'timeline' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('timeline')}
                >
                  <History className="mr-1 h-4 w-4" />
                  Timeline
                </Button>
              </div>
            </div>

            {summary && (
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Memory digest
                </p>
                <p className="text-sm text-muted-foreground">{summary}</p>
              </div>
            )}

            {view === 'timeline' ? (
              <MemoryTimeline groups={timeline} onSelect={openFromTimeline} />
            ) : (
              <>
                {!loading && memories.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No memories yet. Add one to let BRO remember it.
                  </p>
                )}
                {memories.map((memory) => {
                  const strength = memoryStrength(memory);
                  return (
                    <div
                      key={memory.id}
                      className="flex items-start justify-between gap-4 rounded-lg border p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{memory.key}</span>
                          <Badge variant="secondary">{MEMORY_KIND_LABELS[memory.kind]}</Badge>
                          {memory.category && <Badge variant="outline">{memory.category}</Badge>}
                          <Badge variant="outline">importance {memory.importance}</Badge>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                          {memory.value}
                        </p>
                        {memory.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {memory.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs font-normal">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/80">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.round(strength * 100)}%` }}
                            />
                          </div>
                          <span>
                            {Math.round(strength * 100)}% strength · recalled {memory.accessCount}{' '}
                            {memory.accessCount === 1 ? 'time' : 'times'} ·{' '}
                            {daysSinceLastSeen(memory) === 0
                              ? 'seen today'
                              : `${daysSinceLastSeen(memory)}d ago`}
                          </span>
                        </div>
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
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
