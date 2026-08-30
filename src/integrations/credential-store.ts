import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger.js';

const CREDENTIALS_DIR = path.join(process.cwd(), 'data');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'integration-credentials.json');

export type ProviderCredential = {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  webhookUrl?: string;
  accessToken?: string;
  extra?: Record<string, string>;
  updatedAt: string;
};

type CredentialStore = Record<string, ProviderCredential>;

let cache: CredentialStore | null = null;

async function ensureDir(): Promise<void> {
  try {
    await mkdir(CREDENTIALS_DIR, { recursive: true });
  } catch {
    // directory already exists
  }
}

async function readStore(): Promise<CredentialStore> {
  if (cache) return cache;
  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf8');
    cache = JSON.parse(raw) as CredentialStore;
  } catch {
    cache = {};
  }
  return cache;
}

async function writeStore(store: CredentialStore): Promise<void> {
  await ensureDir();
  cache = store;
  await writeFile(CREDENTIALS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export async function getCredential(providerId: string): Promise<ProviderCredential | null> {
  const store = await readStore();
  return store[providerId] ?? null;
}

export async function getAllCredentials(): Promise<Record<string, ProviderCredential>> {
  return readStore();
}

export async function saveCredential(
  providerId: string,
  data: Omit<ProviderCredential, 'updatedAt'>,
): Promise<ProviderCredential> {
  const store = await readStore();
  const existing = store[providerId];
  const credential: ProviderCredential = {
    ...data,
    extra: { ...(existing?.extra ?? {}), ...(data.extra ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  store[providerId] = credential;
  await writeStore(store);
  logger.info(`Credential saved for provider: ${providerId}`);
  return credential;
}

export async function deleteCredential(providerId: string): Promise<boolean> {
  const store = await readStore();
  if (!(providerId in store)) return false;
  delete store[providerId];
  await writeStore(store);
  logger.info(`Credential deleted for provider: ${providerId}`);
  return true;
}

/**
 * Check whether a provider is configured — either via env vars or via
 * admin-stored credentials. This replaces the static `oauthConfigured`
 * check on ProviderDef at runtime.
 */
export function isProviderConfigured(
  providerId: string,
  envClientId: string,
  envClientSecret: string,
): boolean {
  if (envClientId && envClientSecret) return true;
  const cred = cache?.[providerId];
  if (!cred) return false;
  if (cred.clientId && cred.clientSecret) return true;
  if (cred.apiKey) return true;
  if (cred.webhookUrl) return true;
  if (cred.accessToken) return true;
  return false;
}

/**
 * Get client credentials for a provider, preferring stored credentials
 * over env vars. Returns [clientId, clientSecret].
 */
export function getClientCredentials(
  providerId: string,
  envClientId: string,
  envClientSecret: string,
): [string, string] {
  const cred = cache?.[providerId];
  if (cred?.clientId && cred?.clientSecret) {
    return [cred.clientId, cred.clientSecret];
  }
  return [envClientId, envClientSecret];
}

export function invalidateCache(): void {
  cache = null;
}
