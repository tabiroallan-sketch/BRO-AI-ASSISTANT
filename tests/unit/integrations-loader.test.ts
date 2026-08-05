import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProvidersFromDisk } from '../../src/integrations/providers/loader.js';
import { clearProviders, getProvider, listProviders } from '../../src/integrations/registry.js';

const validProvider = `export default {
  id: 'disk-test',
  label: 'Disk Test',
  description: 'A provider installed from disk',
  type: 'oauth',
  icon: 'external',
  oauthConfigured: true,
  scopes: ['read'],
  capabilities: ['disk:read'],
  permissions: [
    { id: 'disk.read', label: 'Read', description: 'Read things', scope: 'read', capability: 'disk:read' },
  ],
  supportsRefresh: true,
  authorizationUrl: 'https://example.com/oauth/authorize',
  tokenUrl: 'https://example.com/oauth/token',
  authorizationParams(state) { return new URLSearchParams({ state }); },
  tokenParams(code) { return new URLSearchParams({ code }); },
  refreshParams() { return new URLSearchParams(); },
  async accountName() { return 'disk-test-user'; },
};
`;

const arrayProvider = `export const providers = [
  {
    id: 'disk-array-a',
    label: 'Array A',
    description: 'First array provider',
    type: 'webhook',
    icon: 'external',
  },
  {
    id: 'disk-array-b',
    label: 'Array B',
    description: 'Second array provider',
    type: 'webhook',
    icon: 'external',
  },
];
`;

const invalidProvider = `export default { id: 'disk-invalid' };
`;

describe('provider disk loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bro-providers-'));
    clearProviders();
  });

  afterEach(async () => {
    clearProviders();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('installs a valid provider exported as default', async () => {
    await writeFile(path.join(tempDir, 'bro.provider.mjs'), validProvider);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded).toEqual(['disk-test']);
    expect(result.failed).toEqual([]);
    expect(getProvider('disk-test')).toBeDefined();
    expect(getProvider('disk-test')?.permissions[0]?.id).toBe('disk.read');
  });

  it('installs multiple providers from a named providers export', async () => {
    await writeFile(path.join(tempDir, 'bro.provider.mjs'), arrayProvider);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded.sort()).toEqual(['disk-array-a', 'disk-array-b']);
    expect(
      listProviders()
        .map((provider) => provider.id)
        .sort(),
    ).toEqual(['disk-array-a', 'disk-array-b']);
  });

  it('records failures for invalid provider files', async () => {
    await writeFile(path.join(tempDir, 'bro.provider.mjs'), invalidProvider);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toContain('requires string "id" and "label"');
    expect(getProvider('disk-invalid')).toBeUndefined();
  });

  it('scans nested directories recursively', async () => {
    await mkdir(path.join(tempDir, 'nested', 'deep'), { recursive: true });
    await writeFile(path.join(tempDir, 'nested', 'deep', 'bro.provider.mjs'), validProvider);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded).toEqual(['disk-test']);
  });

  it('ignores files that do not match the provider file pattern', async () => {
    await writeFile(path.join(tempDir, 'not-a-provider.mjs'), validProvider);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded).toEqual([]);
  });

  it('skips providers whose id collides with an installed provider', async () => {
    await writeFile(path.join(tempDir, 'bro.provider.mjs'), validProvider);
    await loadProvidersFromDisk(tempDir);
    const result = await loadProvidersFromDisk(tempDir);
    expect(result.loaded).toEqual([]);
    expect(getProvider('disk-test')).toBeDefined();
  });
});
