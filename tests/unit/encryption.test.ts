import { describe, expect, it, beforeAll } from 'vitest';

process.env.ENCRYPTION_KEY = 'unit-test-encryption-key-0123456789';
process.env.JWT_SECRET = 'unit-test-jwt-fallback';
process.env.NODE_ENV = 'development';

type EncryptionModule = typeof import('../../src/lib/encryption.js');

describe('symmetric encryption', () => {
  let encryption: EncryptionModule;

  beforeAll(async () => {
    encryption = await import('../../src/lib/encryption.js');
  });

  it('reports encryption as enabled when a key is set', () => {
    expect(encryption.isEncryptionEnabled()).toBe(true);
  });

  it('round-trips a value', () => {
    const plaintext = 'access_token_abc123';
    const encrypted = encryption.encryptValue(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encryption.decryptValue(encrypted)).toBe(plaintext);
  });

  it('produces a fresh IV on every encryption', () => {
    const encrypted1 = encryption.encryptValue('same value');
    const encrypted2 = encryption.encryptValue('same value');
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('throws when the ciphertext is tampered with', () => {
    const encrypted = encryption.encryptValue('do not touch me');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => encryption.decryptValue(tampered)).toThrow();
  });

  it('passes through empty strings unchanged', () => {
    expect(encryption.encryptValue('')).toBe('');
    expect(encryption.decryptValue('')).toBe('');
  });

  it('passes through values that are not marked encrypted', () => {
    expect(encryption.decryptValue('plaintext-token')).toBe('plaintext-token');
  });
});
