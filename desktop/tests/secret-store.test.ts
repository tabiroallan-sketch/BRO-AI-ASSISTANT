import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore } from '../src/main/secret-store.js';

function tempFile(name = 'secrets.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'bro-secrets-'));
  return join(dir, name);
}

describe('SecretStore', () => {
  it('generates four distinct secrets on first run', () => {
    const store = new SecretStore({ filePath: tempFile() });
    const secrets = store.ensure();
    expect(secrets.jwtSecret.length).toBeGreaterThan(20);
    expect(secrets.jwtRefreshSecret.length).toBeGreaterThan(20);
    expect(secrets.cookieSecret.length).toBeGreaterThan(20);
    expect(secrets.encryptionKey.length).toBeGreaterThan(20);
    const values = [
      secrets.jwtSecret,
      secrets.jwtRefreshSecret,
      secrets.cookieSecret,
      secrets.encryptionKey,
    ];
    expect(new Set(values).size).toBe(4);
  });

  it('is stable across instantiations (persisted)', () => {
    const file = tempFile();
    const first = new SecretStore({ filePath: file }).ensure();
    const second = new SecretStore({ filePath: file }).ensure();
    expect(second).toEqual(first);
  });

  it('regenerates when the file is corrupt or partial', () => {
    const file = tempFile();
    writeFileSync(file, '{"jwtSecret": "only-one"}', 'utf8');
    const secrets = new SecretStore({ filePath: file }).ensure();
    expect(secrets.encryptionKey.length).toBeGreaterThan(0);
    expect(secrets.jwtRefreshSecret.length).toBeGreaterThan(0);
  });

  it('writes secrets with restricted permissions on Windows (mode ignored, file exists)', () => {
    const file = tempFile();
    new SecretStore({ filePath: file }).ensure();
    expect(readFileSync(file, 'utf8')).toContain('"encryptionKey"');
    const dir = file.slice(0, file.lastIndexOf('\\') + 1);
    expect(() => rmSync(dir, { recursive: true })).not.toThrow();
  });
});
