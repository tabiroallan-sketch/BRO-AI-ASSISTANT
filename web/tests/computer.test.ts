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
import { decideAction, listSystemActions } from '@/lib/computer';
import { setTokens } from '@/lib/token-store';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const pendingAction = {
  id: 'act-1',
  userId: 'u1',
  toolName: 'system_delete',
  args: { path: 'C:\\tmp\\notes.txt' },
  summary: 'Delete C:\\tmp\\notes.txt (moves it to the Recycle Bin)',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:10:00.000Z',
  status: 'pending',
};

describe('computer client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setTokens('access-token', 'refresh-token');
  });

  it('lists pending actions and system tools', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        actions: [pendingAction],
        tools: [
          {
            name: 'system_create_folder',
            description: 'Create a folder',
            requireConfirmation: true,
          },
          {
            name: 'system_read_clipboard',
            description: 'Read clipboard',
            requireConfirmation: false,
          },
        ],
      }),
    );

    const result = await listSystemActions();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/system/actions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    );
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].toolName).toBe('system_delete');
    expect(result.tools[0].requireConfirmation).toBe(true);
  });

  it('passes the limit query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ actions: [], tools: [] }));

    await listSystemActions(10);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/system/actions?limit=10',
      expect.any(Object),
    );
  });

  it('posts an approval decision', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        action: { ...pendingAction, status: 'approved', result: 'Deleted notes.txt.' },
      }),
    );

    const action = await decideAction('act-1', 'approve');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/v1/system/actions/act-1/decision',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    expect(action.status).toBe('approved');
    expect(action.result).toBe('Deleted notes.txt.');
  });

  it('posts a rejection decision', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ action: { ...pendingAction, status: 'rejected' } }));

    const action = await decideAction('act-1', 'reject');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      decision: 'reject',
    });
    expect(action.status).toBe('rejected');
  });
});
