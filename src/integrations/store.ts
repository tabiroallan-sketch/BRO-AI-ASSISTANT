import { Prisma, prisma } from '../lib/prisma.js';
import { decryptValue, encryptValue } from '../lib/encryption.js';
import { recordAudit } from '../lib/audit.js';
import { emitIntegrationEvent } from './events.js';
import {
  REFRESH_WINDOW_MS,
  hashToken,
  refreshAccessToken,
  secureEqual,
  withRefreshFlight,
} from './oauth-engine.js';
import { getGrantedPermissions } from './permissions.js';
import { getProvider, type ProviderDef } from './providers.js';
import { savePermissionSet } from './trust-store.js';

export type IntegrationRecord = {
  id: string;
  userId: string;
  provider: string;
  accountKey: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  refreshTokenHash: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Prisma.JsonValue;
  isPrimary: boolean;
  lastRefreshedAt: Date | null;
  refreshCount: number;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
};

export type UpsertIntegrationInput = {
  provider: string;
  accountKey?: string;
  accountName?: string | null;
  externalId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string | null;
  metadata?: Record<string, unknown>;
};

function resolveAccountKey(input: UpsertIntegrationInput): string {
  return input.accountKey ?? input.externalId ?? 'default';
}

function metadataOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

type IntegrationWriteFields = {
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Prisma.InputJsonValue;
};

function encryptionData(input: UpsertIntegrationInput): IntegrationWriteFields {
  return {
    accountName: input.accountName ?? null,
    externalId: input.externalId ?? null,
    accessToken: encryptValue(input.accessToken),
    refreshToken: input.refreshToken ? encryptValue(input.refreshToken) : null,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    scopes: input.scopes ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
  };
}

function decryptRecord(record: IntegrationRecord): IntegrationRecord {
  return {
    ...record,
    accessToken: decryptValue(record.accessToken),
    refreshToken: record.refreshToken ? decryptValue(record.refreshToken) : null,
  };
}

export async function upsertIntegration(
  userId: string,
  input: UpsertIntegrationInput,
): Promise<void> {
  if (!prisma) {
    throw new Error('Database not configured');
  }
  const accountKey = resolveAccountKey(input);
  const data = encryptionData(input);

  let record: IntegrationRecord;
  const existing = await prisma.integration.findUnique({
    where: {
      userId_provider_accountKey: { userId, provider: input.provider, accountKey },
    },
  });

  if (existing) {
    const primaryExists = await prisma.integration.findFirst({
      where: { userId, provider: input.provider, isPrimary: true },
      select: { id: true },
    });
    record = await prisma.integration.update({
      where: { id: existing.id },
      data: {
        ...data,
        refreshTokenHash: input.refreshToken ? hashToken(input.refreshToken) : null,
        lastRefreshedAt: null,
        refreshCount: 0,
        revokedAt: null,
        revokedReason: null,
        ...(primaryExists ? {} : { isPrimary: true }),
      },
    });
  } else {
    const count = await prisma.integration.count({
      where: { userId, provider: input.provider },
    });
    record = await prisma.integration.create({
      data: {
        userId,
        provider: input.provider,
        accountKey,
        ...data,
        refreshTokenHash: input.refreshToken ? hashToken(input.refreshToken) : null,
        isPrimary: count === 0,
      },
    });
  }

  if (input.scopes) {
    const provider = getProvider(input.provider);
    const granted = provider
      ? getGrantedPermissions(provider, input.scopes)
          .filter((permission) => permission.enabled)
          .map((permission) => permission.id)
      : [];
    await savePermissionSet(record.id, input.scopes, granted);
  }
}

export async function deleteIntegration(userId: string, providerId: string): Promise<void> {
  if (!prisma) {
    throw new Error('Database not configured');
  }
  const result = await prisma.integration.deleteMany({
    where: { userId, provider: providerId },
  });
  if (result.count > 0) {
    emitIntegrationEvent({ type: 'disconnected', provider: providerId, userId });
  }
}

export async function getIntegration(
  userId: string,
  providerId: string,
  accountKey?: string,
): Promise<IntegrationRecord | null> {
  if (!prisma) {
    return null;
  }
  let record: IntegrationRecord | null;
  if (accountKey) {
    record = await prisma.integration.findUnique({
      where: { userId_provider_accountKey: { userId, provider: providerId, accountKey } },
    });
  } else {
    record =
      (await prisma.integration.findFirst({
        where: { userId, provider: providerId, isPrimary: true },
      })) ??
      (await prisma.integration.findFirst({
        where: { userId, provider: providerId },
        orderBy: { createdAt: 'desc' },
      }));
  }
  if (!record) {
    return null;
  }
  return decryptRecord(record);
}

export async function listUserIntegrations(
  userId: string,
): Promise<Map<string, IntegrationRecord>> {
  if (!prisma) {
    return new Map();
  }
  const records = await prisma.integration.findMany({
    where: { userId },
  });
  const byProvider = new Map<string, IntegrationRecord[]>();
  for (const record of records) {
    const list = byProvider.get(record.provider) ?? [];
    list.push(decryptRecord(record));
    byProvider.set(record.provider, list);
  }
  const primary = new Map<string, IntegrationRecord>();
  for (const [provider, list] of byProvider) {
    const chosen = list.find((record) => record.isPrimary) ?? list[0];
    if (chosen) {
      primary.set(provider, chosen);
    }
  }
  return primary;
}

export async function listProviderAccounts(
  userId: string,
  providerId: string,
): Promise<IntegrationRecord[]> {
  if (!prisma) {
    return [];
  }
  const records = await prisma.integration.findMany({
    where: { userId, provider: providerId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  });
  return records.map(decryptRecord);
}

/**
 * Returns every non-revoked integration across all users. Used by the
 * background health monitor to sweep the whole installation; the returned
 * records are already decrypted.
 */
export async function listConnectedIntegrations(): Promise<IntegrationRecord[]> {
  if (!prisma) {
    return [];
  }
  const records = await prisma.integration.findMany({
    where: { revokedAt: null },
  });
  return records.map(decryptRecord);
}

export async function setPrimaryIntegration(
  userId: string,
  providerId: string,
  accountId: string,
): Promise<boolean> {
  if (!prisma) {
    return false;
  }
  const target = await prisma.integration.findFirst({
    where: { id: accountId, userId, provider: providerId },
    select: { id: true },
  });
  if (!target) {
    return false;
  }
  await prisma.$transaction([
    prisma.integration.updateMany({
      where: { userId, provider: providerId },
      data: { isPrimary: false },
    }),
    prisma.integration.update({
      where: { id: accountId },
      data: { isPrimary: true },
    }),
  ]);
  return true;
}

/**
 * Persists the per-connection auto-reconnect preference in integration.metadata
 * so the background health monitor knows whether to attempt a token refresh
 * (or disable a dead connection) without user intervention.
 */
export async function setAutoReconnect(
  userId: string,
  providerId: string,
  enabled: boolean,
  accountKey?: string,
): Promise<boolean> {
  if (!prisma) {
    return false;
  }
  const record = await getIntegration(userId, providerId, accountKey);
  if (!record) {
    return false;
  }
  const metadata = metadataOf(record.metadata);
  await prisma.integration.update({
    where: { id: record.id },
    data: { metadata: { ...metadata, autoReconnect: enabled } as Prisma.InputJsonValue },
  });
  return true;
}

export async function getValidAccessToken(
  userId: string,
  providerId: string,
  accountKey?: string,
): Promise<string | null> {
  const integration = await getIntegration(userId, providerId, accountKey);
  if (!integration) {
    return null;
  }
  if (integration.revokedAt) {
    return null;
  }
  const provider = getProvider(providerId) as ProviderDef | undefined;
  const needsRefresh =
    integration.tokenExpiresAt !== null &&
    integration.tokenExpiresAt.getTime() - REFRESH_WINDOW_MS < Date.now() &&
    Boolean(integration.refreshToken) &&
    provider?.type === 'oauth' &&
    provider.supportsRefresh;

  if (needsRefresh && integration.refreshToken) {
    return withRefreshFlight(integration.id, async () => {
      if (
        integration.refreshTokenHash &&
        !secureEqual(hashToken(integration.refreshToken as string), integration.refreshTokenHash)
      ) {
        await revokeIntegration(integration.id, 'refresh_token_reuse');
        recordAudit({
          actorId: userId,
          action: 'integration.revoke',
          target: integration.id,
          detail: 'refresh_token_reuse',
        });
        emitIntegrationEvent({
          type: 'token_revoked',
          provider: providerId,
          userId,
          reason: 'refresh_token_reuse',
        });
        return null;
      }
      try {
        const refreshed = await refreshAccessToken(providerId, integration.refreshToken as string);
        await rotateIntegrationTokens(integration.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? (integration.refreshToken as string),
          expiresIn: refreshed.expiresIn,
          scope: refreshed.scope ?? undefined,
          refreshCount: (integration.refreshCount ?? 0) + 1,
        });
        emitIntegrationEvent({ type: 'token_refreshed', provider: providerId, userId });
        return refreshed.accessToken;
      } catch {
        return null;
      }
    });
  }

  return integration.accessToken;
}

export type RotateTokensInput = {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  scope?: string;
  refreshCount: number;
};

export async function rotateIntegrationTokens(
  integrationId: string,
  input: RotateTokensInput,
): Promise<void> {
  if (!prisma) {
    return;
  }
  const data: Prisma.IntegrationUpdateInput = {
    accessToken: encryptValue(input.accessToken),
    refreshToken: encryptValue(input.refreshToken),
    refreshTokenHash: hashToken(input.refreshToken),
    tokenExpiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null,
    lastRefreshedAt: new Date(),
    refreshCount: input.refreshCount,
    revokedAt: null,
    revokedReason: null,
  };
  if (input.scope !== undefined) {
    data.scopes = input.scope;
  }
  await prisma.integration.update({ where: { id: integrationId }, data });
}

export async function revokeIntegration(integrationId: string, reason: string): Promise<void> {
  if (!prisma) {
    return;
  }
  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      accessToken: '',
      refreshToken: null,
      refreshTokenHash: null,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
}

export async function deleteIntegrationAccount(
  userId: string,
  providerId: string,
  accountId: string,
  revokeToken?: (token: string) => Promise<void>,
): Promise<boolean> {
  if (!prisma) {
    return false;
  }
  const target = await prisma.integration.findFirst({
    where: { id: accountId, userId, provider: providerId },
  });
  if (!target) {
    return false;
  }
  if (revokeToken && target.accessToken) {
    try {
      await revokeToken(decryptValue(target.accessToken));
    } catch {
      // Provider-side revocation is best-effort; local removal always proceeds.
    }
  }
  const others = await prisma.integration.findMany({
    where: { userId, provider: providerId },
    orderBy: { createdAt: 'desc' },
  });
  await prisma.integration.delete({ where: { id: accountId } });
  if (target.isPrimary) {
    const successor = others.find((record) => record.id !== accountId);
    if (successor) {
      await prisma.integration.update({
        where: { id: successor.id },
        data: { isPrimary: true },
      });
    }
  }
  emitIntegrationEvent({ type: 'disconnected', provider: providerId, userId });
  return true;
}
