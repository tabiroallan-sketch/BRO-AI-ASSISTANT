import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeSecrets } from './servers/api-server.js';

function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

type SecretsFile = RuntimeSecrets;

/**
 * Generates and persists the secrets the backend needs in production mode
 * (JWT signing, cookie signing, encryption-at-rest). Stored as a JSON file in
 * the userData directory and generated once on first launch, so integration
 * tokens stay encrypted across restarts without any user setup.
 */
export class SecretStore {
  private readonly filePath: string;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
  }

  ensure(): RuntimeSecrets {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SecretsFile>;
      const secrets: SecretsFile = {
        jwtSecret: parsed.jwtSecret ?? '',
        jwtRefreshSecret: parsed.jwtRefreshSecret ?? '',
        cookieSecret: parsed.cookieSecret ?? '',
        encryptionKey: parsed.encryptionKey ?? '',
      };
      if (secrets.jwtSecret && secrets.jwtRefreshSecret && secrets.encryptionKey) {
        return secrets;
      }
    } catch {
      // Missing or corrupt file: generate fresh secrets below.
    }

    const secrets: SecretsFile = {
      jwtSecret: newSecret(),
      jwtRefreshSecret: newSecret(),
      cookieSecret: newSecret(),
      encryptionKey: newSecret(),
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(tempPath, this.filePath);
    return secrets;
  }
}
