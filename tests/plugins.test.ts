import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

type MockUser = {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  googleId: string | null;
};

const { mockPrisma, registerAndLogin } = vi.hoisted(() => {
  process.env.DATABASE_URL = '';
  process.env.REDIS_URL = '';
  process.env.JWT_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const users = new Map<string, MockUser>();

  const userModel = {
    async findUnique(args: { where: { id: string } }): Promise<MockUser | null> {
      return users.get(args.where.id) ?? null;
    },
  };

  async function registerAndLogin(email: string): Promise<string> {
    const user: MockUser = {
      id: randomUUID(),
      email,
      role: 'USER',
      isActive: true,
      displayName: null,
      avatarUrl: null,
      googleId: null,
    };
    users.set(user.id, user);
    const { signAccessToken } = await import('../src/lib/jwt.js');
    return signAccessToken(user.id, user.role);
  }

  return {
    mockPrisma: {
      user: userModel,
      $disconnect: async (): Promise<void> => undefined,
    },
    registerAndLogin,
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

const VALID_PLUGIN = `
export default {
  name: 'hello-plugin',
  version: '1.0.0',
  description: 'A hello plugin',
  author: 'Tester',
  tools: [
    {
      name: 'hello_tool',
      description: 'Says hello',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'hello from plugin',
    },
  ],
};
`;

const LIFECYCLE_PLUGIN = `
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export default {
  name: 'lifecycle-plugin',
  version: '2.0.0',
  setup: async (context) => {
    await writeFile(path.join(context.basePath, 'setup-ran.txt'), 'ok');
  },
  teardown: async (context) => {
    await writeFile(path.join(context.basePath, 'teardown-ran.txt'), 'ok');
  },
  tools: [
    {
      name: 'lifecycle_tool',
      description: 'Lifecycle tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'lifecycle',
    },
  ],
};
`;

const DISABLED_PLUGIN = `
export default {
  name: 'disabled-plugin',
  version: '1.0.0',
  enabled: false,
  tools: [
    {
      name: 'disabled_tool',
      description: 'Should never register',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'nope',
    },
  ],
};
`;

const INVALID_PLUGIN = `
export default { name: 'broken-plugin' };
`;

const THROWING_PLUGIN = `
throw new Error('boom');
`;

async function writePlugin(dir: string, file: string, contents: string): Promise<string> {
  const pluginDir = path.join(dir, file);
  await mkdir(pluginDir, { recursive: true });
  const target = path.join(pluginDir, 'bro.plugin.mjs');
  await writeFile(target, contents, 'utf8');
  return target;
}

describe('plugin loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bro-plugins-unit-'));
  });

  describe('loadPluginsFromDisk', () => {
    it('loads plugins from a directory and registers their tools', async () => {
      const { loadPluginsFromDisk } = await import('../src/plugins/loader.js');
      const { getTool } = await import('../src/tools/registry.js');
      await writePlugin(tempDir, 'hello', VALID_PLUGIN);
      await writePlugin(tempDir, 'lifecycle', LIFECYCLE_PLUGIN);

      const result = await loadPluginsFromDisk(tempDir);

      expect(result.failed).toEqual([]);
      expect(result.loaded.map((plugin) => plugin.name).sort()).toEqual([
        'hello-plugin',
        'lifecycle-plugin',
      ]);
      expect(await getTool('hello_tool')?.execute({}, { userId: 'u' })).toBe('hello from plugin');
      expect(await getTool('lifecycle_tool')?.execute({}, { userId: 'u' })).toBe('lifecycle');
    });

    it('skips plugins marked as disabled', async () => {
      const { loadPluginsFromDisk } = await import('../src/plugins/loader.js');
      const { getTool } = await import('../src/tools/registry.js');
      await writePlugin(tempDir, 'disabled', DISABLED_PLUGIN);

      const result = await loadPluginsFromDisk(tempDir);

      expect(result.skipped).toEqual(['disabled-plugin']);
      expect(result.loaded).toEqual([]);
      expect(getTool('disabled_tool')).toBeUndefined();
    });

    it('records failures without throwing for invalid or broken plugins', async () => {
      const { loadPluginsFromDisk } = await import('../src/plugins/loader.js');
      await writePlugin(tempDir, 'invalid', INVALID_PLUGIN);
      await writePlugin(tempDir, 'throwing', THROWING_PLUGIN);

      const result = await loadPluginsFromDisk(tempDir);

      expect(result.loaded).toEqual([]);
      expect(result.failed).toHaveLength(2);
      for (const failure of result.failed) {
        expect(failure.file).toMatch(/bro\.plugin\.mjs$/);
        expect(failure.error.length).toBeGreaterThan(0);
      }
    });

    it('runs setup on load and teardown on unload', async () => {
      const { loadPluginsFromDisk, unloadAllPlugins } = await import('../src/plugins/loader.js');
      const { getTool, listTools } = await import('../src/tools/registry.js');
      const pluginDir = await writePlugin(tempDir, 'lifecycle', LIFECYCLE_PLUGIN);
      const basePath = path.dirname(pluginDir);

      await loadPluginsFromDisk(tempDir);
      await readFile(path.join(basePath, 'setup-ran.txt'), 'utf8');
      expect(listTools().some((tool) => tool.name === 'lifecycle_tool')).toBe(true);

      await unloadAllPlugins();
      await readFile(path.join(basePath, 'teardown-ran.txt'), 'utf8');
      expect(getTool('lifecycle_tool')).toBeUndefined();
    });

    it('returns an empty result when the directory does not exist', async () => {
      const { loadPluginsFromDisk } = await import('../src/plugins/loader.js');
      const result = await loadPluginsFromDisk(path.join(tempDir, 'missing'));
      expect(result).toEqual({ loaded: [], skipped: [], failed: [] });
    });
  });

  describe('validatePluginManifest', () => {
    it('accepts a valid manifest', async () => {
      const { validatePluginManifest } = await import('../src/plugins/manifest.js');
      const result = validatePluginManifest({ name: 'a', version: '1.0.0' });
      expect(result.ok).toBe(true);
    });

    it('rejects a manifest without a name or version', async () => {
      const { validatePluginManifest } = await import('../src/plugins/manifest.js');
      expect(validatePluginManifest({}).ok).toBe(false);
      expect(validatePluginManifest({ name: 'a' }).ok).toBe(false);
    });
  });
});

describe('plugin endpoints', () => {
  let app: FastifyInstance;
  let pluginsDir: string;

  beforeAll(async () => {
    const { config } = await import('../src/config/index.js');
    pluginsDir = await mkdtemp(path.join(os.tmpdir(), 'bro-plugins-test-'));
    await writePlugin(pluginsDir, 'hello', VALID_PLUGIN);
    (config as { pluginsDir: string }).pluginsDir = pluginsDir;

    const { buildApp } = await import('../src/app.js');
    app = buildApp();
    await app.ready();
  }, 60000);

  afterAll(async () => {
    await app.close();
    await rm(pluginsDir, { recursive: true, force: true });
  });

  it('lists installed plugins with their tools', async () => {
    const token = await registerAndLogin('plugins@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plugins',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.count).toBeGreaterThan(0);
    const hello = body.plugins.find((plugin: { name: string }) => plugin.name === 'hello-plugin');
    expect(hello).toBeDefined();
    expect(hello.version).toBe('1.0.0');
    expect(hello.state).toBe('loaded');
    expect(hello.tools).toEqual(['hello_tool']);
  });

  it('reloads plugins from disk', async () => {
    const token = await registerAndLogin('plugins-reload@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/plugins/reload',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.reloaded).toBe(true);
    expect(body.loaded.some((plugin: { name: string }) => plugin.name === 'hello-plugin')).toBe(
      true,
    );
    expect(body.failed).toEqual([]);
  });

  it('requires authentication for both endpoints', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/plugins' });
    expect(list.statusCode).toBe(401);

    const reload = await app.inject({ method: 'POST', url: '/api/v1/plugins/reload' });
    expect(reload.statusCode).toBe(401);
  });
});
