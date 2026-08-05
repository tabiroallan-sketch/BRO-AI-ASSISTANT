import { decryptValue, encryptValue, isEncryptionEnabled } from '../lib/encryption.js';

export const encryptCredential = encryptValue;
export const decryptCredential = decryptValue;

export function credentialsAreEncrypted(): boolean {
  return isEncryptionEnabled();
}

/**
 * Renders a credential safely for display (e.g. "••••1234"). Never reveals more
 * than the last four characters.
 */
export function maskCredential(value: string, visibleChars = 4): string {
  if (!value) {
    return '';
  }
  const visible = Math.max(0, Math.min(visibleChars, value.length));
  if (visible === 0) {
    return '••••';
  }
  return `••••${value.slice(-visible)}`;
}
