import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../lib/logger.js';
import { registerTool, unregisterTool } from '../tools/registry.js';
import { validatePluginManifest } from './manifest.js';
import {
  clearPlugins,
  getPlugin,
  listPlugins,
  registerPlugin,
  unregisterPlugin,
} from './registry.js';
import type { BroPlugin, PluginContext, PluginLoadResult, PluginSummary } from './types.js';

const PLUGIN_FILE_PATTERN = /^bro\.plugin\.(ts|js|mjs|cjs)$/;

function makeContext(basePath: string): PluginContext {
  return {
    basePath,
    log: {
      info: (msg: string, ...args: unknown[]) =>
        logger.info({ plugin: basePath }, `${msg}${args.length ? ` ${JSON.stringify(args)}` : ''}`),
      warn: (msg: string, ...args: unknown[]) =>
        logger.warn({ plugin: basePath }, `${msg}${args.length ? ` ${JSON.stringify(args)}` : ''}`),
      error: (msg: string, ...args: unknown[]) =>
        logger.error(
          { plugin: basePath },
          `${msg}${args.length ? ` ${JSON.stringify(args)}` : ''}`,
        ),
    },
  };
}

async function findPluginFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      found.push(...(await findPluginFiles(fullPath)));
    } else if (entry.isFile() && PLUGIN_FILE_PATTERN.test(entry.name)) {
      found.push(fullPath);
    }
  }
  return found;
}

async function loadPluginFile(
  file: string,
): Promise<
  { summary: PluginSummary; manifest: BroPlugin; tools: string[] } | { summary: PluginSummary }
> {
  const url = pathToFileURL(file).href;
  const imported = (await import(url)) as Record<string, unknown>;
  const raw = imported.default ?? imported.plugin;
  if (raw === undefined) {
    throw new Error('plugin file must export a manifest as default or named "plugin" export');
  }

  const validation = validatePluginManifest(raw);
  if (!validation.ok) {
    throw new Error(`invalid manifest: ${validation.error}`);
  }
  const manifest = validation.manifest;
  const context = makeContext(path.dirname(file));

  if (manifest.enabled === false) {
    return {
      summary: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        enabled: false,
        state: 'loaded',
        tools: [],
      },
    };
  }

  if (manifest.setup) {
    await manifest.setup(context);
  }

  const tools = (manifest.tools ?? [])
    .filter((tool) => {
      if (registerTool(tool)) {
        return true;
      }
      logger.warn(
        { plugin: manifest.name, tool: tool.name },
        'Plugin tool name is already registered and was skipped',
      );
      return false;
    })
    .map((tool) => tool.name);

  registerPlugin(manifest.name, manifest, path.dirname(file), tools);

  return {
    summary: {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      enabled: true,
      state: 'loaded',
      tools,
    },
    manifest,
    tools,
  };
}

async function unloadPlugin(name: string): Promise<void> {
  const plugin = getPlugin(name);
  if (!plugin) {
    return;
  }
  try {
    if (plugin.manifest.teardown) {
      await plugin.manifest.teardown(makeContext(plugin.basePath));
    }
  } catch (error) {
    logger.warn({ err: error, plugin: name }, 'Plugin teardown failed');
  }
  for (const toolName of plugin.tools) {
    unregisterTool(toolName);
  }
  unregisterPlugin(name);
}

export async function loadPluginsFromDisk(dir: string): Promise<PluginLoadResult> {
  for (const plugin of listPlugins()) {
    await unloadPlugin(plugin.manifest.name);
  }
  clearPlugins();

  const files = await findPluginFiles(dir);
  const result: PluginLoadResult = { loaded: [], skipped: [], failed: [] };

  const outcomes = await Promise.all(
    files.map(async (file) => {
      try {
        const outcome = await loadPluginFile(file);
        return { file, outcome };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, file }, 'Failed to load plugin');
        return { file, error: message };
      }
    }),
  );

  for (const { file, outcome, error } of outcomes) {
    if (error) {
      result.failed.push({ file, error });
    } else if (outcome && 'manifest' in outcome) {
      result.loaded.push(outcome.summary);
    } else if (outcome) {
      result.skipped.push(outcome.summary.name);
    }
  }

  return result;
}

export async function unloadAllPlugins(): Promise<void> {
  for (const plugin of listPlugins()) {
    await unloadPlugin(plugin.manifest.name);
  }
  clearPlugins();
}

export async function reloadPlugins(dir: string): Promise<PluginLoadResult> {
  return loadPluginsFromDisk(dir);
}
