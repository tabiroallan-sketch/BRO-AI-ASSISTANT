import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../src/lib/llm-config-crypto.js';

describe('llm config crypto', () => {
  it('round-trips a secret', () => {
    const encrypted = encryptSecret('sk-super-secret-123');
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toContain('sk-super-secret-123');
    expect(decryptSecret(encrypted)).toBe('sk-super-secret-123');
  });

  it('produces a different ciphertext each time for the same value', () => {
    const first = encryptSecret('same');
    const second = encryptSecret('same');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('same');
    expect(decryptSecret(second)).toBe('same');
  });

  it('returns null for empty input', () => {
    expect(encryptSecret('')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret('')).toBeNull();
  });

  it('returns null for malformed payloads', () => {
    expect(decryptSecret('not-a-valid-payload')).toBeNull();
    expect(decryptSecret('aa:bb:cc')).toBeNull();
    expect(decryptSecret('!!:!!:!!')).toBeNull();
  });

  it('fails to decrypt tampered ciphertext', () => {
    const encrypted = encryptSecret('tamper-me');
    expect(encrypted).not.toBeNull();
    const parts = (encrypted as string).split(':');
    parts[2] = Buffer.from('corrupted!').toString('base64');
    expect(decryptSecret(parts.join(':'))).toBeNull();
  });
});
