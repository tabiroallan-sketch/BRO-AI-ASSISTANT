import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const accounts: Array<{ id: string; accessToken: string | null; refreshToken: string | null }> =
    [];
  const updates: Array<Record<string, unknown>> = [];
  return {
    accounts,
    updates,
    findMany: vi.fn(),
    update: vi.fn(),
    isEncryptionEnabled: vi.fn(),
    encryptValue: vi.fn((value: string) => `enc:v1:${value}`),
  };
});

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    account: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}));

vi.mock('../../src/lib/encryption.js', () => ({
  isEncryptionEnabled: mocks.isEncryptionEnabled,
  encryptValue: mocks.encryptValue,
}));

type MigrationModule = typeof import('../../src/lib/migrations.js');

describe('migrateLegacyGoogleAccountTokens', () => {
  let migrations: MigrationModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    migrations = await import('../../src/lib/migrations.js');
  });

  it('re-encrypts plaintext google tokens when encryption is enabled', async () => {
    mocks.isEncryptionEnabled.mockReturnValue(true);
    mocks.findMany.mockResolvedValue([
      { id: 'acct-1', accessToken: 'plain_access_1', refreshToken: 'plain_refresh_1' },
      { id: 'acct-2', accessToken: 'enc:v1:already', refreshToken: 'enc:v1:already' },
      { id: 'acct-3', accessToken: 'plain_access_3', refreshToken: null },
    ]);

    const result = await migrations.migrateLegacyGoogleAccountTokens();

    expect(result).toEqual({ migrated: 2, total: 3 });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { accessToken: 'enc:v1:plain_access_1', refreshToken: 'enc:v1:plain_refresh_1' },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'acct-3' },
      data: { accessToken: 'enc:v1:plain_access_3' },
    });
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct-2' } }),
    );
  });

  it('does not touch rows already encrypted', async () => {
    mocks.isEncryptionEnabled.mockReturnValue(true);
    mocks.findMany.mockResolvedValue([
      { id: 'acct-1', accessToken: 'enc:v1:x', refreshToken: 'enc:v1:y' },
    ]);

    const result = await migrations.migrateLegacyGoogleAccountTokens();

    expect(result).toEqual({ migrated: 0, total: 1 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('skips entirely when encryption is disabled', async () => {
    mocks.isEncryptionEnabled.mockReturnValue(false);

    const result = await migrations.migrateLegacyGoogleAccountTokens();

    expect(result).toEqual({ migrated: 0, total: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
