import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../src/tools/types.js';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    notification: {
      create: mockCreate,
    },
  },
}));

import { notifyTool } from '../src/tools/notify.js';

const context: ToolContext = { userId: 'user-1' };

beforeEach(() => {
  mockCreate.mockReset();
});

describe('notify tool', () => {
  it('creates a notification with title and body', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'n1',
      title: 'Report ready',
      body: 'Your report is ready to download',
      createdAt: new Date('2026-08-03T12:00:00Z'),
    });

    const output = await notifyTool.execute(
      { title: 'Report ready', body: 'Your report is ready to download' },
      context,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', title: 'Report ready', body: 'Your report is ready to download' },
      select: { id: true, title: true, body: true, createdAt: true },
    });
    expect(String(output)).toContain('Report ready');
  });

  it('stores body as null when absent', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'n2',
      title: 'Reminder',
      body: null,
      createdAt: new Date(),
    });

    await notifyTool.execute({ title: 'Reminder' }, context);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', title: 'Reminder', body: null },
      select: { id: true, title: true, body: true, createdAt: true },
    });
  });

  it('throws when the title is missing', async () => {
    await expect(notifyTool.execute({}, context)).rejects.toThrow(/Missing "title"/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
