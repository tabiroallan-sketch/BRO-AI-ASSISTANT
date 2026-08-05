import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return createHash('sha256').update(config.jwtSecret).digest();
}

/** Encrypts a value to `iv:tag:ciphertext` base64. Returns null for empty input. */
export function encryptSecret(value: string): string | null {
  if (!value) {
    return null;
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64')).join(':');
}

/** Decrypts a value produced by `encryptSecret`. Returns null on failure or empty input. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) {
    return null;
  }
  const [iv, tag, ciphertext] = payload.split(':');
  if (!iv || !tag || !ciphertext) {
    return null;
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
