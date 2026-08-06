import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.MARKETPLACE_STATE_FILE = path.join(tmpdir(), `bro-mkt-unit-state-${process.pid}.json`);

import {
  applyMarketplaceState,
  buildMarketplace,
  catalog,
  getCatalogItem,
  installItem,
  isItemInstalled,
  loadMarketplaceState,
  resetMarketplaceState,
  uninstallItem,
  updateItem,
} from '../../src/integrations/marketplace.js';
import { clearProviders, getProvider, listProviders } from '../../src/integrations/registry.js';

describe('marketplace catalog', () => {
  it('ships 7 bundled, 8 available, and 10 roadmap items', () => {
    const installed = catalog.filter((entry) => entry.status === 'installed');
    const available = catalog.filter((entry) => entry.status === 'available');
    const future = catalog.filter((entry) => entry.status === 'future');
    expect(installed.map((entry) => entry.id).sort()).toEqual(
      ['google', 'drive', 'github', 'slack', 'discord', 'notion', 'whatsapp'].sort(),
    );
    expect(available.map((entry) => entry.id).sort()).toEqual(
      ['dropbox', 'zoom', 'clickup', 'stripe', 'openai', 'nvidia', 'gemini', 'anthropic'].sort(),
    );
    expect(future.map((entry) => entry.id).sort()).toEqual(
      [
        'trello',
        'asana',
        'linear',
        'jira',
        'shopify',
        'salesforce',
        'hubspot',
        'airtable',
        'telegram',
        'pipedrive',
      ].sort(),
    );
  });

  it('gives every bundled and available item a real provider adapter', () => {
    for (const entry of catalog) {
      if (entry.status === 'future') {
        expect(entry.providerIds).toEqual([]);
        expect(entry.defs).toEqual([]);
        continue;
      }
      expect(entry.providerIds.length).toBeGreaterThan(0);
      expect(entry.defs.length).toBe(entry.providerIds.length);
      for (const def of entry.defs) {
        expect(def.id).toBeTruthy();
        expect(def.label).toBeTruthy();
        expect(def.capabilities.length).toBeGreaterThan(0);
      }
    }
  });

  it('looks up items by id', () => {
    expect(getCatalogItem('dropbox')?.name).toBe('Dropbox');
    expect(getCatalogItem('missing')).toBeUndefined();
  });
});

describe('marketplace install state', () => {
  let dir: string;
  let stateFile: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bro-marketplace-unit-'));
    stateFile = path.join(dir, 'state.json');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  beforeEach(async () => {
    clearProviders();
    resetMarketplaceState();
    const { registerProvider } = await import('../../src/integrations/registry.js');
    for (const entry of catalog.filter((item) => item.status === 'installed')) {
      for (const def of entry.defs) {
        registerProvider(def);
      }
    }
    await rm(stateFile, { force: true }).catch(() => undefined);
  });

  it('registers bundled providers and nothing else by default', async () => {
    await applyMarketplaceState(stateFile);
    expect(getProvider('github')).toBeDefined();
    expect(getProvider('google-drive')).toBeDefined();
    expect(getProvider('dropbox')).toBeUndefined();
    expect(getProvider('openai')).toBeUndefined();
  });

  it('installs an available item, registers its adapter, and persists state', async () => {
    await applyMarketplaceState(stateFile);
    const view = await installItem('dropbox', 'user-1', stateFile);

    expect(view.installed).toBe(true);
    expect(getProvider('dropbox')).toBeDefined();
    expect(listProviders().some((provider) => provider.id === 'dropbox')).toBe(true);

    const raw = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(raw.installed).toContain('dropbox');
    expect(isItemInstalled(getCatalogItem('dropbox')!)).toBe(true);
  });

  it('uninstalls an item, unregisters its adapter, and updates persisted state', async () => {
    await installItem('openai', 'user-1', stateFile);
    const view = await uninstallItem('openai', 'user-1', stateFile);

    expect(view.installed).toBe(false);
    expect(getProvider('openai')).toBeUndefined();
    const raw = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(raw.installed).not.toContain('openai');
  });

  it('disables bundled items instead of tracking them as installed', async () => {
    await applyMarketplaceState(stateFile);
    await uninstallItem('github', 'user-1', stateFile);

    expect(getProvider('github')).toBeUndefined();
    const raw = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(raw.disabled).toContain('github');
    expect(raw.installed).toEqual([]);

    await installItem('github', 'user-1', stateFile);
    expect(getProvider('github')).toBeDefined();
  });

  it('reloads persisted state from disk', async () => {
    await installItem('zoom', 'user-1', stateFile);
    resetMarketplaceState();

    const loaded = await loadMarketplaceState(stateFile);
    expect(loaded.installed).toContain('zoom');

    await applyMarketplaceState(stateFile);
    expect(getProvider('zoom')).toBeDefined();
  });

  it('rebuilds the marketplace view from the current state', async () => {
    await applyMarketplaceState(stateFile);
    await installItem('anthropic', 'user-1', stateFile);

    const view = await buildMarketplace('user-1');
    expect(view.installed.some((item) => item.id === 'anthropic')).toBe(true);
    expect(view.available.some((item) => item.id === 'anthropic')).toBe(false);
    expect(view.installed.some((item) => item.id === 'github')).toBe(true);
    expect(view.future.some((item) => item.id === 'linear')).toBe(true);
  });

  it('marks token adapters with their configurable fields', async () => {
    await applyMarketplaceState(stateFile);
    const view = await buildMarketplace('user-1');
    const openai = view.available.find((item) => item.id === 'openai');
    expect(openai?.authType).toBe('token');
    expect(openai?.fields?.map((field) => field.name)).toEqual(['apiKey']);
  });

  it('rejects installing a roadmap item', async () => {
    await applyMarketplaceState(stateFile);
    await expect(installItem('trello', 'user-1', stateFile)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects installing an unknown item', async () => {
    await applyMarketplaceState(stateFile);
    await expect(installItem('unknown', 'user-1', stateFile)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('reports no update available when the adapter ships with the bundle', async () => {
    await applyMarketplaceState(stateFile);
    await installItem('dropbox', 'user-1', stateFile);
    const result = await updateItem('dropbox');
    expect(result.updated).toBe(false);
  });
});
