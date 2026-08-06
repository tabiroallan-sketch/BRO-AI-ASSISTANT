import { Prisma, prisma } from '../lib/prisma.js';
import type { ConnectionStatus, HealthIssue, QuotaInfo } from './types.js';

export type StoredIntegrationStatus = {
  id: string;
  integrationId: string;
  status: ConnectionStatus;
  ok: boolean;
  latencyMs: number | null;
  lastMessage: string | null;
  lastHealthCheckAt: Date;
  lastSuccessAt: Date | null;
  code: string | null;
  apiStatus: string | null;
  quota: QuotaInfo | null;
  updatedAt: Date;
};

export type StoredPermissionSet = {
  id: string;
  integrationId: string;
  scopes: string[];
  permissionIds: string[];
  grantedAt: Date;
  updatedAt: Date;
};

export type StoredSyncRecord = {
  id: string;
  integrationId: string;
  kind: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: Date;
  finishedAt: Date | null;
  itemCount: number | null;
  error: string | null;
  detail: Prisma.JsonValue | null;
  createdAt: Date;
};

type Db = NonNullable<typeof prisma>;

/**
 * Sentinel used to clear a nullable JSON column. Vitest mocks that omit the
 * `Prisma` export throw when the binding is touched, so the read is guarded.
 */
const PRISMA_DB_NULL: Prisma.NullTypes.DbNull = (() => {
  try {
    return (Prisma?.DbNull ?? null) as unknown as Prisma.NullTypes.DbNull;
  } catch {
    return null as unknown as Prisma.NullTypes.DbNull;
  }
})();

function prismaWith(model: string): Db | null {
  if (prisma === null) {
    return null;
  }
  const candidate = prisma as unknown as Record<string, unknown>;
  return candidate[model] != null ? prisma : null;
}

export async function recordIntegrationStatus(
  integrationId: string,
  input: {
    status: ConnectionStatus;
    issue?: HealthIssue | null;
    ok: boolean;
    latencyMs: number | null;
    message: string | null;
    code?: string | null;
    apiStatus?: string | null;
    quota?: QuotaInfo | null;
  },
): Promise<void> {
  const db = prismaWith('integrationStatus');
  if (!db) {
    return;
  }
  const now = new Date();
  const code = input.code ?? input.issue ?? null;
  const quota = input.quota ?? PRISMA_DB_NULL;
  await db.integrationStatus.upsert({
    where: { integrationId },
    update: {
      status: input.status,
      ok: input.ok,
      latencyMs: input.latencyMs,
      lastMessage: input.message,
      lastHealthCheckAt: now,
      lastSuccessAt: input.ok ? now : undefined,
      code,
      apiStatus: input.apiStatus ?? null,
      quota,
    },
    create: {
      integrationId,
      status: input.status,
      ok: input.ok,
      latencyMs: input.latencyMs,
      lastMessage: input.message,
      lastHealthCheckAt: now,
      lastSuccessAt: input.ok ? now : null,
      code,
      apiStatus: input.apiStatus ?? null,
      quota,
    },
  });
}

export async function getIntegrationStatus(
  integrationId: string,
): Promise<StoredIntegrationStatus | null> {
  const db = prismaWith('integrationStatus');
  if (!db) {
    return null;
  }
  const row = await db.integrationStatus.findUnique({ where: { integrationId } });
  if (!row) {
    return null;
  }
  const quota =
    typeof row.quota === 'object' && row.quota !== null ? (row.quota as QuotaInfo) : null;
  return {
    ...row,
    status: row.status as ConnectionStatus,
    code: row.code ?? null,
    apiStatus: row.apiStatus ?? null,
    quota,
  };
}

export async function savePermissionSet(
  integrationId: string,
  scopes: string,
  permissionIds: string[],
): Promise<void> {
  const db = prismaWith('permissionSet');
  if (!db) {
    return;
  }
  const scopeList = scopes.split(/\s+/).filter(Boolean);
  await db.permissionSet.upsert({
    where: { integrationId },
    update: {
      scopes: scopeList as Prisma.InputJsonValue,
      permissionIds: permissionIds as Prisma.InputJsonValue,
      grantedAt: new Date(),
    },
    create: {
      integrationId,
      scopes: scopeList as Prisma.InputJsonValue,
      permissionIds: permissionIds as Prisma.InputJsonValue,
    },
  });
}

export async function getPermissionSet(integrationId: string): Promise<StoredPermissionSet | null> {
  const db = prismaWith('permissionSet');
  if (!db) {
    return null;
  }
  const row = await db.permissionSet.findUnique({ where: { integrationId } });
  if (!row) {
    return null;
  }
  return {
    ...row,
    scopes: Array.isArray(row.scopes)
      ? (row.scopes as unknown[]).filter((value): value is string => typeof value === 'string')
      : [],
    permissionIds: Array.isArray(row.permissionIds)
      ? (row.permissionIds as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  };
}

/**
 * Persists the user's chosen set of enabled permission ids for an integration
 * while preserving the scopes that were recorded at connect time. Used by the
 * Permission Center so users can enable or disable capabilities independently
 * of the provider-scope grants.
 */
export async function updatePermissionSet(
  integrationId: string,
  permissionIds: string[],
): Promise<void> {
  const db = prismaWith('permissionSet');
  if (!db) {
    return;
  }
  const existing = await db.permissionSet.findUnique({ where: { integrationId } });
  const scopes = Array.isArray(existing?.scopes)
    ? (existing.scopes as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  await db.permissionSet.upsert({
    where: { integrationId },
    update: {
      permissionIds: permissionIds as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
    create: {
      integrationId,
      scopes: scopes as Prisma.InputJsonValue,
      permissionIds: permissionIds as Prisma.InputJsonValue,
    },
  });
}

export async function startSync(integrationId: string, kind = 'health'): Promise<string | null> {
  const db = prismaWith('syncHistory');
  if (!db) {
    return null;
  }
  const row = await db.syncHistory.create({
    data: { integrationId, kind, status: 'RUNNING' },
  });
  return row.id;
}

export async function completeSync(
  syncId: string,
  input: { itemCount?: number; detail?: Record<string, unknown> },
): Promise<void> {
  const db = prismaWith('syncHistory');
  if (!db) {
    return;
  }
  await db.syncHistory.update({
    where: { id: syncId },
    data: {
      status: 'SUCCESS',
      finishedAt: new Date(),
      itemCount: input.itemCount,
      detail: (input.detail ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function failSync(syncId: string, error: string): Promise<void> {
  const db = prismaWith('syncHistory');
  if (!db) {
    return;
  }
  await db.syncHistory.update({
    where: { id: syncId },
    data: { status: 'FAILED', finishedAt: new Date(), error },
  });
}

export async function listSyncHistory(
  userId: string,
  provider: string,
  limit = 20,
): Promise<StoredSyncRecord[]> {
  const db = prismaWith('syncHistory');
  if (!db) {
    return [];
  }
  const rows = await db.syncHistory.findMany({
    where: { integration: { userId, provider } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({
    ...row,
    status: row.status as StoredSyncRecord['status'],
  }));
}
