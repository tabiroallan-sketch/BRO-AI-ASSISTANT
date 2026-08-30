import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { HttpError } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { getProvider, registerProvider, unregisterProvider } from './registry.js';
import { listUserIntegrations } from './store.js';
import type { ProviderAuthType, ProviderDef, TokenField } from './types.js';
import { anthropicProvider } from './providers/anthropic/index.js';
import { clickupProvider } from './providers/clickup/index.js';
import { discordProvider } from './providers/discord/index.js';
import { dropboxProvider } from './providers/dropbox/index.js';
import { geminiProvider } from './providers/gemini/index.js';
import { githubProvider } from './providers/github/index.js';
import { googleProviders } from './providers/google/index.js';
import { notionProvider } from './providers/notion/index.js';
import { nvidiaProvider } from './providers/nvidia/index.js';
import { openaiProvider } from './providers/openai/index.js';
import { slackProvider } from './providers/slack/index.js';
import { stripeProvider } from './providers/stripe/index.js';
import { whatsappProvider } from './providers/whatsapp/index.js';
import { zoomProvider } from './providers/zoom/index.js';

export type MarketplaceItemStatus = 'installed' | 'available' | 'future';

export type MarketplaceCatalogItem = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  latestVersion: string;
  author: string;
  status: MarketplaceItemStatus;
  authType: ProviderAuthType;
  providerIds: string[];
  bundled: boolean;
  requiredEnv: string[];
  defs: ProviderDef[];
};

export type MarketplaceItemView = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  latestVersion: string;
  author: string;
  status: MarketplaceItemStatus;
  authType: ProviderAuthType;
  providerIds: string[];
  bundled: boolean;
  requiredEnv: string[];
  installed: boolean;
  connected: boolean;
  configured: boolean;
  accountName: string | null;
  capabilities: string[];
  fields?: TokenField[];
  updateAvailable: boolean;
};

export type MarketplaceResponse = {
  installed: MarketplaceItemView[];
  available: MarketplaceItemView[];
  future: MarketplaceItemView[];
};

const VERSION = '1.0.0';
const AUTHOR = 'BRO Team';
const GOOGLE_SUITE_IDS = [
  'google-calendar',
  'google-gmail',
  'google-docs',
  'google-sheets',
  'google-tasks',
  'google-contacts',
  'google-slides',
];

const googleSuiteDefs = googleProviders.filter((provider) =>
  GOOGLE_SUITE_IDS.includes(provider.id),
);
const driveDef = googleProviders.find((provider) => provider.id === 'google-drive');

type ItemInput = Omit<MarketplaceCatalogItem, 'version' | 'latestVersion' | 'author' | 'defs'> & {
  defs: ProviderDef[];
};

function item(input: ItemInput): MarketplaceCatalogItem {
  return {
    version: VERSION,
    latestVersion: VERSION,
    author: AUTHOR,
    ...input,
  };
}

/**
 * The integration marketplace catalog. `status` is the fixed catalog bucket a
 * provider ships in; whether it is currently enabled for the server is the
 * per-item `installed` flag resolved from the persisted state.
 */
export const catalog: MarketplaceCatalogItem[] = [
  // ── Installed (bundled) ──────────────────────────────────────────────────
  item({
    id: 'google',
    name: 'Google',
    description: 'Calendar, Gmail, Docs, Sheets, Slides, Tasks, and Contacts.',
    icon: 'google',
    category: 'Productivity',
    status: 'installed',
    authType: 'oauth',
    providerIds: GOOGLE_SUITE_IDS,
    bundled: true,
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    defs: googleSuiteDefs,
  }),
  item({
    id: 'drive',
    name: 'Google Drive',
    description: 'List, read, and upload files in your Drive.',
    icon: 'drive',
    category: 'Storage',
    status: 'installed',
    authType: 'oauth',
    providerIds: ['google-drive'],
    bundled: true,
    requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    defs: driveDef ? [driveDef] : [],
  }),
  item({
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues, pull requests, actions, and releases.',
    icon: 'github',
    category: 'Developer tools',
    status: 'installed',
    authType: 'oauth',
    providerIds: ['github'],
    bundled: true,
    requiredEnv: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    defs: [githubProvider],
  }),
  item({
    id: 'slack',
    name: 'Slack',
    description: 'Channels, messages, users, threads, and status.',
    icon: 'slack',
    category: 'Communication',
    status: 'installed',
    authType: 'oauth',
    providerIds: ['slack'],
    bundled: true,
    requiredEnv: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    defs: [slackProvider],
  }),
  item({
    id: 'discord',
    name: 'Discord',
    description: 'Post messages to channels via webhook.',
    icon: 'discord',
    category: 'Communication',
    status: 'installed',
    authType: 'webhook',
    providerIds: ['discord'],
    bundled: true,
    requiredEnv: [],
    defs: [discordProvider],
  }),
  item({
    id: 'notion',
    name: 'Notion',
    description: 'Read and search pages, databases, and blocks.',
    icon: 'notion',
    category: 'Productivity',
    status: 'installed',
    authType: 'oauth',
    providerIds: ['notion'],
    bundled: true,
    requiredEnv: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
    defs: [notionProvider],
  }),
  item({
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Send messages via the WhatsApp Business API.',
    icon: 'whatsapp',
    category: 'Communication',
    status: 'installed',
    authType: 'token',
    providerIds: ['whatsapp'],
    bundled: true,
    requiredEnv: [],
    defs: [whatsappProvider],
  }),

  // ── Available (installable adapters) ─────────────────────────────────────
  item({
    id: 'dropbox',
    name: 'Dropbox',
    description: 'List, read, and upload files in your Dropbox.',
    icon: 'dropbox',
    category: 'Storage',
    status: 'available',
    authType: 'oauth',
    providerIds: ['dropbox'],
    bundled: false,
    requiredEnv: ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'],
    defs: [dropboxProvider],
  }),
  item({
    id: 'zoom',
    name: 'Zoom',
    description: 'Meetings, recordings, and user information.',
    icon: 'zoom',
    category: 'Video conferencing',
    status: 'available',
    authType: 'oauth',
    providerIds: ['zoom'],
    bundled: false,
    requiredEnv: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
    defs: [zoomProvider],
  }),
  item({
    id: 'clickup',
    name: 'ClickUp',
    description: 'Tasks, spaces, folders, lists, and teams.',
    icon: 'clickup',
    category: 'Project management',
    status: 'available',
    authType: 'oauth',
    providerIds: ['clickup'],
    bundled: false,
    requiredEnv: ['CLICKUP_CLIENT_ID', 'CLICKUP_CLIENT_SECRET'],
    defs: [clickupProvider],
  }),
  item({
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments, customers, products, and account details.',
    icon: 'stripe',
    category: 'Finance',
    status: 'available',
    authType: 'token',
    providerIds: ['stripe'],
    bundled: false,
    requiredEnv: [],
    defs: [stripeProvider],
  }),
  item({
    id: 'openai',
    name: 'OpenAI',
    description: 'Chat completions, models, and assistants.',
    icon: 'openai',
    category: 'AI & ML',
    status: 'available',
    authType: 'token',
    providerIds: ['openai'],
    bundled: false,
    requiredEnv: [],
    defs: [openaiProvider],
  }),
  item({
    id: 'nvidia',
    name: 'NVIDIA',
    description: 'NVIDIA NIM models and inference APIs.',
    icon: 'nvidia',
    category: 'AI & ML',
    status: 'available',
    authType: 'token',
    providerIds: ['nvidia'],
    bundled: false,
    requiredEnv: [],
    defs: [nvidiaProvider],
  }),
  item({
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini models for chat and content generation.',
    icon: 'gemini',
    category: 'AI & ML',
    status: 'available',
    authType: 'token',
    providerIds: ['gemini'],
    bundled: false,
    requiredEnv: [],
    defs: [geminiProvider],
  }),
  item({
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models for chat and text generation.',
    icon: 'anthropic',
    category: 'AI & ML',
    status: 'available',
    authType: 'token',
    providerIds: ['anthropic'],
    bundled: false,
    requiredEnv: [],
    defs: [anthropicProvider],
  }),

  // ── Future (roadmap) ─────────────────────────────────────────────────────
  item({
    id: 'trello',
    name: 'Trello',
    description: 'Boards, cards, and lists on the roadmap.',
    icon: 'trello',
    category: 'Project management',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'asana',
    name: 'Asana',
    description: 'Tasks and projects on the roadmap.',
    icon: 'asana',
    category: 'Project management',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking on the roadmap.',
    icon: 'linear',
    category: 'Project management',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'jira',
    name: 'Jira',
    description: 'Issues and sprints on the roadmap.',
    icon: 'jira',
    category: 'Project management',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'shopify',
    name: 'Shopify',
    description: 'Store orders and products on the roadmap.',
    icon: 'shopify',
    category: 'Commerce',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'salesforce',
    name: 'Salesforce',
    description: 'CRM records on the roadmap.',
    icon: 'salesforce',
    category: 'CRM',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Contacts and pipelines on the roadmap.',
    icon: 'hubspot',
    category: 'CRM',
    status: 'future',
    authType: 'oauth',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'airtable',
    name: 'Airtable',
    description: 'Bases and records on the roadmap.',
    icon: 'airtable',
    category: 'Productivity',
    status: 'future',
    authType: 'token',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'telegram',
    name: 'Telegram',
    description: 'Chats and bots on the roadmap.',
    icon: 'telegram',
    category: 'Communication',
    status: 'future',
    authType: 'token',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
  item({
    id: 'pipedrive',
    name: 'Pipedrive',
    description: 'Deals and pipelines on the roadmap.',
    icon: 'pipedrive',
    category: 'CRM',
    status: 'future',
    authType: 'token',
    providerIds: [],
    bundled: false,
    requiredEnv: [],
    defs: [],
  }),
];

export function getCatalogItem(id: string): MarketplaceCatalogItem | undefined {
  return catalog.find((entry) => entry.id === id);
}

export function listInstalledItemIds(): string[] {
  return catalog.filter((entry) => isItemInstalled(entry)).map((entry) => entry.id);
}

// ── Persisted install state ────────────────────────────────────────────────

export type MarketplaceState = {
  installed: string[];
  disabled: string[];
};

let state: MarketplaceState = { installed: [], disabled: [] };
let stateLoaded = false;
let stateApplied = false;

function stateFile(): string {
  return config.marketplaceStateFile;
}

async function readState(file: string): Promise<MarketplaceState> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MarketplaceState>;
    return {
      installed: Array.isArray(parsed.installed)
        ? parsed.installed.filter((id): id is string => typeof id === 'string')
        : [],
      disabled: Array.isArray(parsed.disabled)
        ? parsed.disabled.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err: error }, 'Failed to read marketplace state');
    }
    return { installed: [], disabled: [] };
  }
}

export async function loadMarketplaceState(file?: string): Promise<MarketplaceState> {
  state = await readState(file ?? stateFile());
  stateLoaded = true;
  stateApplied = false;
  return state;
}

export async function persistMarketplaceState(file?: string): Promise<void> {
  const target = file ?? stateFile();
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    logger.error({ err: error }, 'Failed to persist marketplace state');
  }
}

export function resetMarketplaceState(): void {
  state = { installed: [], disabled: [] };
  stateLoaded = false;
  stateApplied = false;
}

export function isItemInstalled(item: MarketplaceCatalogItem): boolean {
  return item.bundled ? !state.disabled.includes(item.id) : state.installed.includes(item.id);
}

/**
 * Syncs the provider registry to the persisted install state: disabled bundled
 * providers are unregistered and installed marketplace adapters are
 * registered. Runs at startup and after every install/uninstall mutation.
 */
export async function applyMarketplaceState(file?: string): Promise<void> {
  if (!stateLoaded) {
    await loadMarketplaceState(file);
  }
  for (const entry of catalog) {
    const wantInstalled = isItemInstalled(entry);
    for (const providerId of entry.providerIds) {
      const present = getProvider(providerId) !== undefined;
      if (wantInstalled && !present) {
        const def = entry.defs.find((candidate) => candidate.id === providerId);
        if (def) {
          registerProvider(def);
        }
      } else if (!wantInstalled && present) {
        unregisterProvider(providerId);
      }
    }
  }
  stateApplied = true;
}

export async function ensureMarketplaceApplied(): Promise<void> {
  if (!stateApplied) {
    await applyMarketplaceState();
  }
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function installItem(
  itemId: string,
  userId: string,
  file?: string,
): Promise<MarketplaceItemView> {
  await ensureMarketplaceApplied();
  const entry = getCatalogItem(itemId);
  if (!entry) {
    throw new HttpError(404, 'Unknown marketplace item');
  }
  if (entry.status === 'future') {
    throw new HttpError(409, `${entry.name} is on the roadmap and not available for install yet`);
  }
  if (entry.bundled) {
    state.disabled = state.disabled.filter((id) => id !== itemId);
  } else if (!state.installed.includes(itemId)) {
    state.installed.push(itemId);
  }
  await applyMarketplaceState(file);
  await persistMarketplaceState(file);
  return viewFor(entry, userId);
}

export async function uninstallItem(
  itemId: string,
  userId: string,
  file?: string,
): Promise<MarketplaceItemView> {
  await ensureMarketplaceApplied();
  const entry = getCatalogItem(itemId);
  if (!entry) {
    throw new HttpError(404, 'Unknown marketplace item');
  }
  if (entry.bundled) {
    if (!state.disabled.includes(itemId)) {
      state.disabled.push(itemId);
    }
  } else {
    state.installed = state.installed.filter((id) => id !== itemId);
  }
  await applyMarketplaceState(file);
  await persistMarketplaceState(file);
  return viewFor(entry, userId);
}

export async function updateItem(itemId: string): Promise<{ updated: boolean; message: string }> {
  const entry = getCatalogItem(itemId);
  if (!entry) {
    throw new HttpError(404, 'Unknown marketplace item');
  }
  if (entry.latestVersion !== entry.version) {
    // A real registry would fetch a newer manifest here; every adapter in this
    // build ships with the bundle, so there is nothing to fetch yet.
    return { updated: true, message: `${entry.name} updated to ${entry.latestVersion}` };
  }
  return { updated: false, message: `${entry.name} is already on the latest version` };
}

// ── Views ──────────────────────────────────────────────────────────────────

async function viewFor(item: MarketplaceCatalogItem, userId: string): Promise<MarketplaceItemView> {
  const records = await listUserIntegrations(userId);
  const record = item.providerIds
    .map((providerId) => records.get(providerId))
    .find((candidate) => candidate !== undefined);
  const def =
    item.providerIds
      .map((providerId) => getProvider(providerId))
      .find((candidate) => candidate !== undefined) ?? item.defs[0];
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    category: item.category,
    version: item.version,
    latestVersion: item.latestVersion,
    author: item.author,
    status: item.status,
    authType: item.authType,
    providerIds: item.providerIds,
    bundled: item.bundled,
    requiredEnv: item.requiredEnv,
    installed: isItemInstalled(item),
    connected: record !== undefined,
    configured: def ? (def.type === 'oauth' ? def.oauthConfigured : true) : false,
    accountName: record?.accountName ?? null,
    capabilities: def?.capabilities ?? [],
    fields: def?.type === 'token' ? def.fields : undefined,
    updateAvailable: item.latestVersion !== item.version,
  };
}

export async function buildMarketplace(userId: string): Promise<MarketplaceResponse> {
  await ensureMarketplaceApplied();
  const installed: MarketplaceItemView[] = [];
  const available: MarketplaceItemView[] = [];
  const future: MarketplaceItemView[] = [];
  for (const entry of catalog) {
    const view = await viewFor(entry, userId);
    if (entry.status === 'future') {
      future.push(view);
    } else if (isItemInstalled(entry)) {
      installed.push(view);
    } else {
      available.push(view);
    }
  }
  return { installed, available, future };
}
