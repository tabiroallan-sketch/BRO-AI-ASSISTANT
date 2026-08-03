import { request } from '@/lib/api';
import { getAccessToken } from '@/lib/token-store';

export type Memory = {
  id: string;
  key: string;
  value: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryInput = {
  key: string;
  value: string;
  category?: string;
};

function authToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

export async function listMemories(): Promise<Memory[]> {
  const result = await request<{ memories: Memory[] }>('/memories', {
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
    },
  });
  return result.memory;
}

export async function updateMemory(
  id: string,
  input: { value: string; category?: string },
): Promise<Memory> {
  const result = await request<{ memory: Memory }>(`/memories/${id}`, {
    method: 'PATCH',
    token: authToken(),
    body: {
      value: input.value,
      ...(input.category ? { category: input.category } : {}),
    },
  });
  return result.memory;
}

export async function deleteMemory(id: string): Promise<void> {
  await request<void>(`/memories/${id}`, {
    method: 'DELETE',
    token: authToken(),
  });
}
