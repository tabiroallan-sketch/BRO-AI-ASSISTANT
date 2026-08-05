import { beforeAll, describe, expect, it } from 'vitest';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-credentials';

type CredentialsModule = typeof import('../../src/integrations/credentials.js');

describe('credential manager', () => {
  let credentials: CredentialsModule;

  beforeAll(async () => {
    credentials = await import('../../src/integrations/credentials.js');
  });

  it('reports encryption as enabled when a key is set', () => {
    expect(credentials.credentialsAreEncrypted()).toBe(true);
  });

  it('round-trips a credential through encrypt and decrypt', () => {
    const plaintext = 'gho_super_secret_token_value';
    const encrypted = credentials.encryptCredential(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(credentials.decryptCredential(encrypted)).toBe(plaintext);
  });

  it('produces versioned ciphertext with a distinct iv per call', () => {
    const first = credentials.encryptCredential('same-value');
    const second = credentials.encryptCredential('same-value');
    expect(first.startsWith('enc:v1:')).toBe(true);
    expect(first).not.toBe(second);
    expect(credentials.decryptCredential(first)).toBe(credentials.decryptCredential(second));
  });

  it('passes through already-plaintext values on decrypt', () => {
    expect(credentials.decryptCredential('not-encrypted')).toBe('not-encrypted');
  });

  it('masks credentials showing only the tail', () => {
    expect(credentials.maskCredential('gho_1234567890')).toBe('••••7890');
  });

  it('handles empty and short inputs', () => {
    expect(credentials.maskCredential('')).toBe('');
    expect(credentials.maskCredential('ab')).toContain('ab');
  });

  it('supports custom visible character counts', () => {
    expect(credentials.maskCredential('abcdef', 2)).toBe('••••ef');
    expect(credentials.maskCredential('abcdef', 0)).toBe('••••');
  });
});
