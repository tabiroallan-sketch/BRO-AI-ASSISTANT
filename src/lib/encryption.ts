import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;
let plaintextMode = false;
let warned = false;

function deriveKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }
  const secret = config.integrationEncryptionKey;
  if (!secret) {
    if (config.nodeEnv === 'production') {
      throw new Error(
        'Encryption key is not configured. Set ENCRYPTION_KEY (or INTEGRATION_ENCRYPTION_KEY) in production.',
      );
    }
    plaintextMode = true;
    cachedKey = Buffer.alloc(0);
    if (!warned) {
      warned = true;
      logger.warn(
        'Encryption is disabled: no ENCRYPTION_KEY set. Sensitive values are stored in plaintext (development only).',
      );
    }
    return cachedKey;
  }
  plaintextMode = false;
  cachedKey = createHash('sha256').update(secret).digest();
  return cachedKey;
}

export function isEncryptionEnabled(): boolean {
  deriveKey();
  return !plaintextMode;
}

export function encryptValue(value: string): string {
  const key = deriveKey();
  if (plaintextMode || value === '') {
    return value;
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptValue(value: string): string {
  const key = deriveKey();
  if (plaintextMode || !value.startsWith('enc:v1:')) {
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted value');
  }
  const iv = Buffer.from(parts[2] ?? '', 'base64');
  const tag = Buffer.from(parts[3] ?? '', 'base64');
  const encrypted = Buffer.from(parts[4] ?? '', 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
