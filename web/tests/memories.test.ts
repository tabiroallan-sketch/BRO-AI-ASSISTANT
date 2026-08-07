vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemory,
  deleteMemory,
  getMemorySummary,
  getMemoryTimeline,
  listMemories,
  updateMemory,
  type Memory,
  type MemoryTimelineGroup,
} from '@/lib/memories';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memoryFixture(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    key: 'name',
    value: 'Alice',
    category: null,
    kind: 'relationship',
    importance: 5,
    tags: [],
    relatedIds: [],
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('memories client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists memories with the bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memories: [memoryFixture()] }));

    const memories = await listMemories();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/memories',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    );
    expect(memories).toHaveLength(1);
    expect(memories[0].key).toBe('name');
  });

  it('passes search, category and kind filters as query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memories: [] }));

    await listMemories({ q: 'where does she live', category: 'personal', kind: 'client' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/memories?q=where+does+she+live&category=personal&kind=client',
      expect.anything(),
    );
  });

  it('creates a memory', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memory: memoryFixture() }, 201));

    const memory = await createMemory({ key: 'name', value: 'Alice' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ key: 'name', value: 'Alice' });
    expect(memory.value).toBe('Alice');
  });

  it('includes an optional category when creating', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memory: memoryFixture({ category: 'personal' }) }));

    await createMemory({ key: 'name', value: 'Alice', category: 'personal' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'name',
      value: 'Alice',
      category: 'personal',
    });
  });

  it('includes kind, importance and tags when creating', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { memory: memoryFixture({ kind: 'client', importance: 8, tags: ['acme'] }) },
        201,
      ),
    );

    await createMemory({
      key: 'company',
      value: 'Acme',
      kind: 'client',
      importance: 8,
      tags: ['acme'],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'company',
      value: 'Acme',
      kind: 'client',
      importance: 8,
      tags: ['acme'],
    });
  });

  it('updates a memory', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memory: memoryFixture({ value: 'Alex' }) }));

    const memory = await updateMemory('m1', { value: 'Alex' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/memories/m1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ value: 'Alex' });
    expect(memory.value).toBe('Alex');
  });

  it('updates a memory with kind and importance', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ memory: memoryFixture({ kind: 'preference', importance: 9 }) }),
    );

    await updateMemory('m1', { kind: 'preference', importance: 9, tags: ['prefers-x'] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'preference',
      importance: 9,
      tags: ['prefers-x'],
    });
  });

  it('deletes a memory', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteMemory('m1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/memories/m1');
    expect(init.method).toBe('DELETE');
  });

  it('fetches the memory timeline', async () => {
    const groups: MemoryTimelineGroup[] = [
      {
        label: 'Today',
        items: [
          {
            ...memoryFixture({ id: 'm2', key: 'client', lastAccessedAt: '2026-01-01T00:00:00Z' }),
            activity: 'accessed',
          },
        ],
      },
    ];
    fetchMock.mockResolvedValue(jsonResponse({ groups }));

    const result = await getMemoryTimeline();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/memories/timeline',
      expect.anything(),
    );
    expect(result).toEqual(groups);
  });

  it('fetches the memory summary (digest)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ summary: 'Alice is a client at Acme.' }));

    const summary = await getMemorySummary();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/memories/summary',
      expect.anything(),
    );
    expect(summary).toBe('Alice is a client at Acme.');
  });

  it('returns null summary when the backend has no digest', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ summary: null }));

    expect(await getMemorySummary()).toBeNull();
  });
});
