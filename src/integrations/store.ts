import { Prisma, prisma } from '../lib/prisma.js';
import { decryptValue, encryptValue } from '../lib/encryption.js';
import { getProvider, type ProviderDef } from './providers.js';
import { refreshProviderToken } from './oauth.js';

export type IntegrationRecord = {
  id: string;
  userId: string;
  provider: string;
  accountName: string | null;
  externalId: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  metadata: Prisma.JsonValue;
};

export type UpsertIntegrationInput = {
  provider: string;
  accountName?: string | null;
  externalId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string | null;
  metadata?: Record<string, unknown>;
};

export async function upsertIntegration(
  userId: string,
  input: UpsertIntegrationInput,
): Promise<void> {
  if (!prisma) {
    throw new Error('Database not configured');
  }
  const data = {
    accountName: input.accountName ?? null,
    externalId: input.externalId ?? null,
    accessToken: encryptValue(input.accessToken),
    refreshToken: input.refreshToken ? encryptValue(input.refreshToken) : null,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    scopes: input.scopes ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
  };
  await prisma.integration.upsert({
    where: {
      userId_provider: { userId, provider: input.provider },
    },
    update: data,
    create: {
      userId,
      provider: input.provider,
      ...data,
    },
  });
}

export async function deleteIntegration(userId: string, providerId: string): Promise<void> {
  if (!prisma) {
    throw new Error('Database not configured');
  }
  await prisma.integration.deleteMany({
    where: { userId, provider: providerId },
  });
}

export async function getIntegration(
  userId: string,
  providerId: string,
): Promise<IntegrationRecord | null> {
  if (!prisma) {
    return null;
  }
  const record = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: providerId } },
  });
  if (!record) {
    return null;
  }
  return {
    ...record,
    accessToken: decryptValue(record.accessToken),
    refreshToken: record.refreshToken ? decryptValue(record.refreshToken) : null,
  };
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
  return new Map(
    records.map((record) => [
      record.provider,
      {
        ...record,
        accessToken: decryptValue(record.accessToken),
        refreshToken: record.refreshToken ? decryptValue(record.refreshToken) : null,
      },
    ]),
  );
}

export async function getValidAccessToken(
  userId: string,
  providerId: string,
): Promise<string | null> {
  const integration = await getIntegration(userId, providerId);
  if (!integration) {
    return null;
  }
  const provider = getProvider(providerId) as ProviderDef | undefined;
  const needsRefresh =
    integration.tokenExpiresAt !== null &&
    integration.tokenExpiresAt.getTime() - 60_000 < Date.now() &&
    Boolean(integration.refreshToken) &&
    provider?.type === 'oauth' &&
    provider.supportsRefresh;

  if (needsRefresh && integration.refreshToken) {
    try {
      const refreshed = await refreshProviderToken(providerId, integration.refreshToken);
      await upsertIntegration(userId, {
        provider: providerId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? integration.refreshToken,
        tokenExpiresAt: refreshed.expiresIn
          ? new Date(Date.now() + refreshed.expiresIn * 1000)
          : null,
        scopes: refreshed.scope,
      });
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  return integration.accessToken;
}
