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

export function clearSecret(name: string): void {
  registered.delete(name);
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

export type SecretDescriptor = {
  name: string;
  description: string;
};

export const KNOWN_SECRETS: SecretDescriptor[] = [
  { name: 'JWT_SECRET', description: 'Access token signing key' },
  { name: 'JWT_REFRESH_SECRET', description: 'Refresh token signing key' },
  { name: 'COOKIE_SECRET', description: 'Cookie signing key' },
  { name: 'ENCRYPTION_KEY', description: 'At-rest credential encryption key' },
  { name: 'INTEGRATION_ENCRYPTION_KEY', description: 'At-rest credential encryption key (alias)' },
  { name: 'OPENAI_API_KEY', description: 'OpenAI API key' },
  { name: 'NVIDIA_API_KEY', description: 'NVIDIA API key' },
  { name: 'ELEVENLABS_API_KEY', description: 'ElevenLabs API key' },
  { name: 'N8N_API_KEY', description: 'n8n API key' },
  { name: 'GOOGLE_CLIENT_ID', description: 'Google OAuth client id' },
  { name: 'GOOGLE_CLIENT_SECRET', description: 'Google OAuth client secret' },
  { name: 'GITHUB_CLIENT_ID', description: 'GitHub OAuth client id' },
  { name: 'GITHUB_CLIENT_SECRET', description: 'GitHub OAuth client secret' },
  { name: 'SLACK_CLIENT_ID', description: 'Slack OAuth client id' },
  { name: 'SLACK_CLIENT_SECRET', description: 'Slack OAuth client secret' },
  { name: 'NOTION_CLIENT_ID', description: 'Notion OAuth client id' },
  { name: 'NOTION_CLIENT_SECRET', description: 'Notion OAuth client secret' },
  { name: 'DROPBOX_CLIENT_ID', description: 'Dropbox OAuth client id' },
  { name: 'DROPBOX_CLIENT_SECRET', description: 'Dropbox OAuth client secret' },
  { name: 'ZOOM_CLIENT_ID', description: 'Zoom OAuth client id' },
  { name: 'ZOOM_CLIENT_SECRET', description: 'Zoom OAuth client secret' },
  { name: 'CLICKUP_CLIENT_ID', description: 'ClickUp OAuth client id' },
  { name: 'CLICKUP_CLIENT_SECRET', description: 'ClickUp OAuth client secret' },
];

export type SecretStatus = {
  name: string;
  description: string;
  configured: boolean;
};

export function listSecretStatuses(): SecretStatus[] {
  return KNOWN_SECRETS.map(({ name, description }) => ({
    name,
    description,
    configured: hasSecret(name),
  }));
}
