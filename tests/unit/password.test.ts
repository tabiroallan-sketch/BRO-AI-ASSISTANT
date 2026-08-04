import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';

describe('password hashing', () => {
  it('produces a scrypt-formatted hash', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$N=16384,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it('round-trips a correct password', async () => {
    const hash = await hashPassword('s3cret-passw0rd!');
    await expect(verifyPassword('s3cret-passw0rd!', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('right-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');
    expect(first).not.toBe(second);
    const saltOf = (hash: string): string => hash.split('$')[2] ?? '';
    expect(saltOf(first)).not.toBe(saltOf(second));
  });

  it('returns false for malformed stored values', async () => {
    await expect(verifyPassword('whatever', '')).resolves.toBe(false);
    await expect(verifyPassword('whatever', 'md5$deadbeef')).resolves.toBe(false);
    await expect(
      verifyPassword('wrong-password', 'scrypt$N=16384,r=8,p=1$00ff$ffffffffffff'),
    ).resolves.toBe(false);
  });
});
