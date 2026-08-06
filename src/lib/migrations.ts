import { encryptValue, isEncryptionEnabled } from './encryption.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';

export type LegacyMigrationResult = {
  migrated: number;
  total: number;
};

export async function migrateLegacyGoogleAccountTokens(): Promise<LegacyMigrationResult> {
  if (!prisma) {
    logger.warn('Database not configured - skipping legacy token migration');
    return { migrated: 0, total: 0 };
  }
  if (!isEncryptionEnabled()) {
    logger.info('Encryption disabled - skipping legacy token migration');
    return { migrated: 0, total: 0 };
  }

  const accounts = await prisma.account.findMany({
    where: { provider: 'google' },
    select: { id: true, accessToken: true, refreshToken: true },
  });

  let migrated = 0;
  for (const account of accounts) {
    const data: { accessToken?: string; refreshToken?: string | null } = {};
    if (account.accessToken && !account.accessToken.startsWith('enc:v1:')) {
      data.accessToken = encryptValue(account.accessToken);
    }
    if (account.refreshToken && !account.refreshToken.startsWith('enc:v1:')) {
      data.refreshToken = encryptValue(account.refreshToken);
    }
    if (data.accessToken !== undefined || data.refreshToken !== undefined) {
      await prisma.account.update({ where: { id: account.id }, data });
      migrated += 1;
    }
  }

  if (migrated > 0) {
    logger.info(
      { migrated, total: accounts.length },
      'Migrated legacy plaintext Google account tokens to encrypted storage',
    );
  }
  return { migrated, total: accounts.length };
}
