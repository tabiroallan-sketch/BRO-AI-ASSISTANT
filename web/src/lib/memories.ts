import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type MemoryKind =
  | 'project'
  | 'goal'
  | 'client'
  | 'preference'
  | 'coding-style'
  | 'meeting'
  | 'idea'
  | 'task'
  | 'relationship'
  | 'other';

export type Memory = {
  id: string;
  key: string;
  value: string;
  category: string | null;
  kind: MemoryKind;
  importance: number;
  tags: string[];
  relatedIds: string[];
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryInput = {
  key: string;
  value: string;
  category?: string;
  kind?: MemoryKind;
  importance?: number;
  tags?: string[];
  relatedIds?: string[];
};

export type MemorySearchOptions = {
  q?: string;
  category?: string;
  kind?: MemoryKind;
};

export type MemoryTimelineItem = Memory & { activity: 'accessed' | 'updated' };

export type MemoryTimelineGroup = {
  label: string;
  items: MemoryTimelineItem[];
};

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  project: 'Project',
  goal: 'Goal',
  client: 'Client',
  preference: 'Preference',
  'coding-style': 'Coding style',
  meeting: 'Meeting',
  idea: 'Idea',
  task: 'Task',
  relationship: 'Relationship',
  other: 'Other',
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listMemories(options: MemorySearchOptions = {}): Promise<Memory[]> {
  const params = new URLSearchParams();
  if (options.q) {
    params.set('q', options.q);
  }
  if (options.category) {
    params.set('category', options.category);
  }
  if (options.kind) {
    params.set('kind', options.kind);
  }
  const query = params.toString();
  const result = await request<{ memories: Memory[] }>(`/memories${query ? `?${query}` : ''}`, {
    token: authToken(),
  });
  return result.memories;
}

export async function createMemory(input: MemoryInput): Promise<Memory> {
  const result = await request<{ memory: Memory }>('/memories', {
    method: 'POST',
    token: authToken(),
    body: {
      key: input.key,
      value: input.value,
      ...(input.category ? { category: input.category } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      ...(input.relatedIds && input.relatedIds.length > 0 ? { relatedIds: input.relatedIds } : {}),
    },
  });
  return result.memory;
}

export async function updateMemory(
  id: string,
  input: {
    value?: string;
    category?: string;
    kind?: MemoryKind;
    importance?: number;
    tags?: string[];
    relatedIds?: string[];
  },
): Promise<Memory> {
  const body: Record<string, unknown> = {};
  if (input.value !== undefined) {
    body.value = input.value;
  }
  if (input.category !== undefined) {
    body.category = input.category;
  }
  if (input.kind !== undefined) {
    body.kind = input.kind;
  }
  if (input.importance !== undefined) {
    body.importance = input.importance;
  }
  if (input.tags !== undefined) {
    body.tags = input.tags;
  }
  if (input.relatedIds !== undefined) {
    body.relatedIds = input.relatedIds;
  }
  const result = await request<{ memory: Memory }>(`/memories/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body,
  });
  return result.memory;
}

export async function deleteMemory(id: string): Promise<void> {
  await request<void>(`/memories/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}

export async function getMemoryTimeline(): Promise<MemoryTimelineGroup[]> {
  const result = await request<{ groups: MemoryTimelineGroup[] }>('/memories/timeline', {
    token: authToken(),
  });
  return result.groups;
}

export async function getMemorySummary(): Promise<string | null> {
  const result = await request<{ summary: string | null }>('/memories/summary', {
    token: authToken(),
  });
  return result.summary;
}
