import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getSecret,
  hasSecret,
  redactJson,
  redactText,
  registerSecret,
  requireSecret,
} from '../../src/lib/secrets.js';

const tempDir = mkdtempSync(join(tmpdir(), 'bro-secrets-'));

describe('secret resolution', () => {
  beforeAll(() => {
    process.env.UNIT_PLAIN_SECRET = 'plain-value';
    process.env.UNIT_FILE_SECRET = 'should-be-overridden';
    writeFileSync(join(tempDir, 'file-secret.txt'), 'value-from-file\n');
    process.env.UNIT_FILE_SECRET_FILE = join(tempDir, 'file-secret.txt');
  });

  afterAll(() => {
    delete process.env.UNIT_PLAIN_SECRET;
    delete process.env.UNIT_FILE_SECRET;
    delete process.env.UNIT_FILE_SECRET_FILE;
  });

  it('reads secrets from the environment', () => {
    expect(getSecret('UNIT_PLAIN_SECRET')).toBe('plain-value');
    expect(hasSecret('UNIT_PLAIN_SECRET')).toBe(true);
  });

  it('prefers the <NAME>_FILE variant over the plain variable', () => {
    expect(getSecret('UNIT_FILE_SECRET')).toBe('value-from-file');
  });

  it('returns an empty string for missing secrets', () => {
    expect(getSecret('UNIT_DOES_NOT_EXIST')).toBe('');
    expect(hasSecret('UNIT_DOES_NOT_EXIST')).toBe(false);
  });

  it('throws when a required secret is missing', () => {
    expect(() => requireSecret('UNIT_REQUIRED_MISSING')).toThrow(
      'Required secret "UNIT_REQUIRED_MISSING" is not configured',
    );
  });

  it('resolves required secrets that exist', () => {
    expect(requireSecret('UNIT_PLAIN_SECRET')).toBe('plain-value');
  });
});

describe('redaction', () => {
  beforeAll(() => {
    registerSecret('supersecret-token-value', 'supersecret-token-value');
  });

  it('replaces long registered secrets in text', () => {
    expect(redactText('token=supersecret-token-value')).toBe('token=[REDACTED]');
  });

  it('ignores secrets shorter than the minimum length', () => {
    registerSecret('shortsecretkey', 'abcd');
    expect(redactText('contains abcd')).toBe('contains abcd');
  });

  it('redacts nested JSON values recursively', () => {
    const input = { headers: { authorization: 'Bearer supersecret-token-value' }, count: 3 };
    const redacted = redactJson(input);
    expect(redacted.headers.authorization).toBe('Bearer [REDACTED]');
    expect(redacted.count).toBe(3);
  });

  it('redacts values inside arrays', () => {
    expect(redactJson(['supersecret-token-value', 'keep'])).toEqual(['[REDACTED]', 'keep']);
  });

  it('leaves primitives untouched', () => {
    expect(redactJson(42)).toBe(42);
    expect(redactJson(null)).toBeNull();
  });
});
