import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setShortcut } from '../src/main/ipc.js';
import { ConfigStore } from '../src/main/config.js';
import { ShortcutRegistry } from '../src/main/shortcuts.js';
import { IPC, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from '../src/shared/desktop-api.js';

type FakeDeps = {
  config: ConfigStore;
  shortcuts: ShortcutRegistry;
  mainWindow: { send: ReturnType<typeof vi.fn> };
};

const dirs: string[] = [];

function makeDeps(overrides: Partial<Pick<FakeDeps, 'mainWindow'>> = {}): FakeDeps {
  const dir = mkdtempSync(join(tmpdir(), 'bro-ipc-shortcuts-'));
  dirs.push(dir);
  const config = new ConfigStore({ filePath: join(dir, 'config.json') });
  const shortcuts = new ShortcutRegistry({
    onTriggered: vi.fn(),
    registerFn: vi.fn().mockReturnValue(true),
    isRegisteredFn: vi.fn().mockReturnValue(true),
  });
  shortcuts.configure({
    'open-overlay': 'Ctrl+Space',
    'hide-overlay': '',
    'push-to-talk': 'Alt+P',
    'open-dashboard': 'Ctrl+Shift+B',
    'toggle-mic': 'Ctrl+Shift+M',
  });
  const mainWindow = { send: vi.fn(), ...overrides.mainWindow };
  return { config, shortcuts, mainWindow };
}

afterEach(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // already gone
    }
  }
  dirs.length = 0;
});

describe('setShortcut', () => {
  it('rejects an unknown action', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'nope' as never, 'Ctrl+X');
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('rejects an invalid accelerator', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'open-overlay', 'Alt');
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('treats a whitespace-only accelerator as a disable', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'open-overlay', '   ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bindings['open-overlay']).toBe('');
    }
  });

  it('rejects a shortcut taken by an action that sorts later', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'open-overlay', 'Ctrl+Shift+B');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('taken');
      expect(result.action).toBe('open-dashboard');
      expect(result.message).toContain(SHORTCUT_LABELS['open-dashboard']);
    }
  });

  it('rejects a shortcut taken by an action that sorts earlier', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'toggle-mic', 'Ctrl+Space');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('taken');
      expect(result.action).toBe('open-overlay');
    }
  });

  it('returns a failed result when the OS rejects the registration', async () => {
    const deps = makeDeps();
    deps.shortcuts = new ShortcutRegistry({
      onTriggered: vi.fn(),
      registerFn: () => false,
    });
    deps.shortcuts.configure({
      'open-overlay': 'Ctrl+Space',
      'hide-overlay': '',
      'push-to-talk': 'Alt+P',
      'open-dashboard': 'Ctrl+Shift+B',
      'toggle-mic': 'Ctrl+Shift+M',
    });
    const result = await setShortcut(deps, 'push-to-talk', 'Alt+K');
    expect(result).toMatchObject({ ok: false, error: 'failed' });
  });

  it('sets a valid shortcut, persists it, and broadcasts the change', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'push-to-talk', 'Alt+K');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.bindings['push-to-talk']).toBe('Alt+K');
    }
    const persisted = await deps.config.get();
    expect(persisted.shortcuts['push-to-talk']).toBe('Alt+K');
    expect(deps.mainWindow.send).toHaveBeenCalledWith(IPC.shortcutsChanged, expect.any(Object));
  });

  it('disables an action with an empty string and persists it', async () => {
    const deps = makeDeps();
    const result = await setShortcut(deps, 'open-overlay', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bindings['open-overlay']).toBe('');
    }
    const persisted = await deps.config.get();
    expect(persisted.shortcuts['open-overlay']).toBe('');
  });

  it('accepts every configured action id', () => {
    expect(SHORTCUT_ACTIONS).toHaveLength(5);
  });
});
