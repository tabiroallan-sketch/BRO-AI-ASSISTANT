import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const integrationStatuses = new Map<string, Row>();
  const permissionSets = new Map<string, Row>();
  const syncRows = new Map<string, Row>();

  const models = {
    integrationStatus: {
      async upsert(args: {
        where: { integrationId: string };
        update: Row;
        create: Row;
      }): Promise<Row> {
        const existing = integrationStatuses.get(args.where.integrationId);
        const record: Row = existing
          ? { ...existing, ...args.update }
          : { id: `status-${integrationStatuses.size + 1}`, ...args.create };
        record.updatedAt = new Date('2026-01-01T00:00:00.000Z');
        integrationStatuses.set(String(args.where.integrationId), record);
        return record;
      },
      async findUnique(args: { where: { integrationId: string } }): Promise<Row | null> {
        return integrationStatuses.get(args.where.integrationId) ?? null;
      },
    },
    permissionSet: {
      async upsert(args: {
        where: { integrationId: string };
        update: Row;
        create: Row;
      }): Promise<Row> {
        const existing = permissionSets.get(args.where.integrationId);
        const record: Row = existing
          ? { ...existing, ...args.update }
          : { id: `permission-${permissionSets.size + 1}`, ...args.create };
        record.updatedAt = new Date('2026-01-01T00:00:00.000Z');
        permissionSets.set(String(args.where.integrationId), record);
        return record;
      },
      async findUnique(args: { where: { integrationId: string } }): Promise<Row | null> {
        return permissionSets.get(args.where.integrationId) ?? null;
      },
    },
    syncHistory: {
      async create(args: { data: Row }): Promise<Row> {
        const record: Row = {
          id: `sync-${syncRows.size + 1}`,
          ...args.data,
          createdAt: new Date(),
        };
        syncRows.set(String(record.id), record);
        return record;
      },
      async update(args: { where: { id: string }; data: Row }): Promise<Row> {
        const existing = syncRows.get(args.where.id);
        if (!existing) {
          throw new Error('Sync record not found');
        }
        const updated = { ...existing, ...args.data };
        syncRows.set(args.where.id, updated);
        return updated;
      },
      async findMany(args: {
        where?: Row;
        orderBy?: { createdAt?: string };
        take?: number;
      }): Promise<Row[]> {
        let list = [...syncRows.values()];
        if (args.orderBy?.createdAt === 'desc') {
          list = list.sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          );
        }
        if (args.take !== undefined) {
          list = list.slice(0, args.take);
        }
        return list;
      },
    },
  };

  const prisma: Record<string, unknown> = {};

  function syncModels(): void {
    for (const key of Object.keys(prisma)) {
      delete prisma[key];
    }
    for (const [name, model] of Object.entries(models)) {
      prisma[name] = model;
    }
  }
  syncModels();

  return {
    prisma,
    models,
    syncModels,
    clearAll(): void {
      integrationStatuses.clear();
      permissionSets.clear();
      syncRows.clear();
    },
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: state.prisma, Prisma: {} }));

import * as trustStore from '../../src/integrations/trust-store.js';

describe('integration trust store', () => {
  beforeEach(() => {
    state.clearAll();
    state.syncModels();
  });

  it('records and reads an integration status snapshot', async () => {
    await trustStore.recordIntegrationStatus('integration-1', {
      status: 'connected',
      ok: true,
      latencyMs: 42,
      message: 'Connected',
    });
    const stored = await trustStore.getIntegrationStatus('integration-1');
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('connected');
    expect(stored?.ok).toBe(true);
    expect(stored?.latencyMs).toBe(42);
    expect(stored?.lastMessage).toBe('Connected');
    expect(stored?.lastSuccessAt).not.toBeNull();
  });

  it('updates an existing status row and clears the success marker on failure', async () => {
    await trustStore.recordIntegrationStatus('integration-1', {
      status: 'connected',
      ok: true,
      latencyMs: 10,
      message: 'Connected',
    });
    await trustStore.recordIntegrationStatus('integration-1', {
      status: 'error',
      ok: false,
      latencyMs: 500,
      message: 'Boom',
    });
    const stored = await trustStore.getIntegrationStatus('integration-1');
    expect(stored?.status).toBe('error');
    expect(stored?.ok).toBe(false);
    expect(stored?.latencyMs).toBe(500);
  });

  it('saves a permission set by splitting scopes and keeping granted ids', async () => {
    await trustStore.savePermissionSet('integration-1', 'repo read:user', [
      'github.repos',
      'github.profile',
    ]);
    const stored = await trustStore.getPermissionSet('integration-1');
    expect(stored?.scopes).toEqual(['repo', 'read:user']);
    expect(stored?.permissionIds).toEqual(['github.repos', 'github.profile']);
  });

  it('updates the enabled permission ids while preserving scopes', async () => {
    await trustStore.savePermissionSet('integration-1', 'repo read:user', [
      'github.repos',
      'github.profile',
    ]);
    await trustStore.updatePermissionSet('integration-1', ['github.repos']);
    const stored = await trustStore.getPermissionSet('integration-1');
    expect(stored?.scopes).toEqual(['repo', 'read:user']);
    expect(stored?.permissionIds).toEqual(['github.repos']);
    expect(stored?.updatedAt).not.toBeNull();
  });

  it('creates a permission set from just the enabled ids when none exists', async () => {
    await trustStore.updatePermissionSet('integration-2', ['github.repos']);
    const stored = await trustStore.getPermissionSet('integration-2');
    expect(stored?.permissionIds).toEqual(['github.repos']);
    expect(stored?.scopes).toEqual([]);
  });

  it('records successful and failed sync runs', async () => {
    const successId = await trustStore.startSync('integration-1');
    expect(successId).not.toBeNull();
    await trustStore.completeSync(successId as string, { detail: { latencyMs: 12 } });

    const failId = await trustStore.startSync('integration-1');
    await trustStore.failSync(failId as string, 'Health check failed');

    const history = await trustStore.listSyncHistory('user-1', 'github', 10);
    expect(history).toHaveLength(2);
    const success = history.find((record) => record.status === 'SUCCESS');
    const failed = history.find((record) => record.status === 'FAILED');
    expect(success?.finishedAt).not.toBeNull();
    expect(failed?.error).toBe('Health check failed');
  });

  it('queries sync history with the caller-provided filter and limit', async () => {
    const spy = vi.spyOn(
      state.models.syncHistory,
      'findMany',
    ) as unknown as typeof state.models.syncHistory.findMany;
    await trustStore.listSyncHistory('user-1', 'github', 5);
    expect(spy).toHaveBeenCalledWith({
      where: { integration: { userId: 'user-1', provider: 'github' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('no-ops when the trust table is not present', async () => {
    state.syncModels();
    delete state.prisma.permissionSet;
    delete state.prisma.syncHistory;
    delete state.prisma.integrationStatus;

    await expect(
      trustStore.savePermissionSet('integration-1', 'repo', ['x']),
    ).resolves.toBeUndefined();
    expect(await trustStore.getPermissionSet('integration-1')).toBeNull();
    expect(await trustStore.startSync('integration-1')).toBeNull();
    expect(await trustStore.listSyncHistory('user-1', 'github')).toEqual([]);
    expect(await trustStore.getIntegrationStatus('integration-1')).toBeNull();
  });
});
