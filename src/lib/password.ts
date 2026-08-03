import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
} as const;

const PREFIX = 'scrypt';

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);
  const derivedKey = await deriveKey(password, salt, SCRYPT_PARAMS.keyLength, SCRYPT_PARAMS);
  const saltHex = salt.toString('hex');
  const keyHex = derivedKey.toString('hex');
  return (
    `${PREFIX}$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$` +
    `${saltHex}$${keyHex}`
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  const [prefix, params] = parts;
  const saltHex = parts[2];
  const keyHex = parts[3];
  if (prefix !== PREFIX || !params || !saltHex || !keyHex) {
    return false;
  }

  const parsed = parseParams(params);
  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(keyHex, 'hex');

  const derivedKey = await deriveKey(password, salt, expectedKey.length, parsed);

  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}

function parseParams(params: string): { N: number; r: number; p: number } {
  const parsed: Record<string, number> = {};
  for (const part of params.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx);
    const value = parseInt(part.slice(idx + 1), 10);
    if (!Number.isNaN(value)) {
      parsed[key] = value;
    }
  }
  return {
    N: parsed.N ?? SCRYPT_PARAMS.N,
    r: parsed.r ?? SCRYPT_PARAMS.r,
    p: parsed.p ?? SCRYPT_PARAMS.p,
  };
}
