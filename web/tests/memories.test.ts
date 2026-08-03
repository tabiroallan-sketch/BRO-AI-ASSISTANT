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
  listMemories,
  updateMemory,
  type Memory,
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

  it('updates a memory', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memory: memoryFixture({ value: 'Alex' }) }));

    const memory = await updateMemory('m1', { value: 'Alex' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/memories/m1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ value: 'Alex' });
    expect(memory.value).toBe('Alex');
  });

  it('deletes a memory', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteMemory('m1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/memories/m1');
    expect(init.method).toBe('DELETE');
  });
});
