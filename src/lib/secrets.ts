import { readFileSync } from 'node:fs';

const registered = new Map<string, string>();

const MIN_SECRET_LENGTH = 6;

function readFromEnvironment(name: string): string {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      const value = readFileSync(filePath, 'utf8').trim();
      if (value) {
        return value;
      }
    } catch {
      // Fall through to the plain environment variable.
    }
  }
  return process.env[name] ?? '';
}

export function getSecret(name: string): string {
  const cached = registered.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const value = readFromEnvironment(name);
  if (value) {
    registered.set(name, value);
  }
  return value;
}

export function requireSecret(name: string): string {
  const value = getSecret(name);
  if (!value) {
    throw new Error(`Required secret "${name}" is not configured`);
  }
  return value;
}

export function registerSecret(name: string, value: string): void {
  if (value) {
    registered.set(name, value);
  }
}

export function hasSecret(name: string): boolean {
  return getSecret(name).length > 0;
}

export function secretNames(): string[] {
  return [...registered.keys()];
}

export function redactText(text: string): string {
  let result = text;
  for (const value of registered.values()) {
    if (value.length < MIN_SECRET_LENGTH) {
      continue;
    }
    result = result.split(value).join('[REDACTED]');
  }
  return result;
}

export function redactJson<T>(value: T): T {
  if (typeof value === 'string') {
    return redactText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJson(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = redactJson(entry);
    }
    return copy as unknown as T;
  }
  return value;
}
