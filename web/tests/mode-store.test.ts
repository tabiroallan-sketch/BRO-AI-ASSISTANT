vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local/api/v1';
});

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
} as unknown as Storage;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDesktopApi,
  type DesktopApi,
  type DesktopConfig,
  type OperatingMode,
} from '@/lib/desktop';
import { initModeSync, modeRoute, useModeStore } from '@/lib/mode-store';

/** The slice of the desktop bridge that mode-store actually consumes. */
type ModeApi = {
  mode: {
    get(): Promise<OperatingMode>;
    set(mode: OperatingMode): Promise<OperatingMode>;
    onChanged(callback: (mode: OperatingMode) => void): () => void;
  };
  config: {
    onChanged(callback: (config: DesktopConfig) => void): () => void;
  };
};

function makeApi(
  overrides: Partial<ModeApi> = {},
): ModeApi & { modeSet: ReturnType<typeof vi.fn> } {
  const modeSet = vi.fn().mockResolvedValue('desktop');
  return {
    mode: {
      get: vi.fn().mockResolvedValue('desktop'),
      set: modeSet,
      onChanged: () => () => {},
    },
    config: {
      onChanged: () => () => {},
    },
    ...overrides,
    modeSet,
  };
}

function installWindow(broDesktop?: DesktopApi | null): void {
  const target = { localStorage, ...(broDesktop ? { broDesktop } : {}) };
  globalThis.window = target as unknown as Window & typeof globalThis;
}

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  useModeStore.setState({ mode: 'desktop', ready: false });
});

describe('modeRoute', () => {
  it('maps each operating mode to its surface route', () => {
    expect(modeRoute('desktop')).toBe('/dashboard');
    expect(modeRoute('overlay')).toBe('/overlay');
    expect(modeRoute('voice')).toBe('/voice');
  });
});

describe('useModeStore (plain browser)', () => {
  it('setMode persists to localStorage and updates the store', () => {
    installWindow();
    expect(getDesktopApi()).toBeNull();

    useModeStore.getState().setMode('voice');

    expect(store.get('bro.mode.v1')).toBe('voice');
    expect(useModeStore.getState().mode).toBe('voice');
  });

  it('applyExternal updates the store from another window / the tray', () => {
    useModeStore.getState().applyExternal('overlay');
    expect(useModeStore.getState().mode).toBe('overlay');
  });
});

describe('initModeSync (desktop shell present)', () => {
  it('loads the persisted mode and marks the store ready', async () => {
    const api = makeApi({
      mode: {
        get: vi.fn().mockResolvedValue('voice'),
        set: vi.fn().mockResolvedValue('voice'),
        onChanged: () => () => {},
      },
    });
    installWindow(api as unknown as DesktopApi);

    const unsubscribe = initModeSync();
    await vi.waitFor(() => {
      expect(useModeStore.getState().ready).toBe(true);
    });

    expect(useModeStore.getState().mode).toBe('voice');
    expect(store.get('bro.mode.v1')).toBe('voice');
    unsubscribe();
  });

  it('applies external mode changes over the IPC broadcast', async () => {
    let onChange: ((mode: OperatingMode) => void) | undefined;
    const api = makeApi({
      mode: {
        get: vi.fn().mockResolvedValue('desktop'),
        set: vi.fn().mockResolvedValue('desktop'),
        onChanged: (callback) => {
          onChange = callback;
          return () => {};
        },
      },
    });
    installWindow(api as unknown as DesktopApi);

    initModeSync();
    await vi.waitFor(() => {
      expect(useModeStore.getState().ready).toBe(true);
    });

    onChange?.('overlay');
    expect(useModeStore.getState().mode).toBe('overlay');
    expect(store.get('bro.mode.v1')).toBe('overlay');
  });

  it('is a no-op when no desktop shell is present', () => {
    installWindow();
    expect(() => initModeSync()).not.toThrow();
    expect(useModeStore.getState().ready).toBe(true);
  });
});
