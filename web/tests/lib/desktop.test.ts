import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  acceleratorFromEvent,
  formatAccelerator,
  getDesktopApi,
  type DesktopApi,
} from '@/lib/desktop';

function installWindow(broDesktop?: DesktopApi | null): void {
  const target = { ...(broDesktop ? { broDesktop } : {}) };
  globalThis.window = target as unknown as Window & typeof globalThis;
}

function keyEvent(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe('formatAccelerator', () => {
  it('formats a modifier + key combo', () => {
    expect(formatAccelerator('CommandOrControl+Shift+B')).toBe('Ctrl/⌘ + Shift + B');
  });

  it('renders a lone key', () => {
    expect(formatAccelerator('Escape')).toBe('Escape');
  });

  it('renders disabled for an empty binding', () => {
    expect(formatAccelerator('')).toBe('Disabled');
  });
});

describe('acceleratorFromEvent', () => {
  it('builds a combo from modifiers and a key', () => {
    const accelerator = acceleratorFromEvent(keyEvent({ key: 'b', ctrlKey: true, shiftKey: true }));
    expect(accelerator).toBe('CommandOrControl+Shift+B');
  });

  it('maps space to Space', () => {
    expect(acceleratorFromEvent(keyEvent({ key: ' ', ctrlKey: true }))).toBe(
      'CommandOrControl+Space',
    );
  });

  it('maps Escape to Escape', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Escape' }))).toBe('Escape');
  });

  it('maps arrow keys to Electron names', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'ArrowUp', altKey: true }))).toBe('Alt+Up');
  });

  it('returns empty while only a modifier is pressed', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Control' }))).toBe('');
    expect(acceleratorFromEvent(keyEvent({ key: 'Shift', ctrlKey: true }))).toBe('');
  });

  it('returns empty for unprintable keys', () => {
    expect(acceleratorFromEvent(keyEvent({ key: 'Dead' }))).toBe('');
  });
});

describe('getDesktopApi', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns null when no desktop shell is present', () => {
    installWindow();
    expect(getDesktopApi()).toBeNull();
  });

  it('fills gaps in a partial/stale bridge so callers never crash', async () => {
    const realBindings = { ...DEFAULT_SHORTCUTS, 'open-overlay': 'Ctrl+Alt+O' };
    installWindow({
      shortcuts: { get: vi.fn().mockResolvedValue(realBindings) },
      mode: { get: vi.fn().mockResolvedValue('voice') },
    } as unknown as DesktopApi);

    const api = getDesktopApi();
    expect(api).not.toBeNull();
    if (!api) {
      throw new Error('expected a bridge');
    }

    // Real members are preserved and used.
    await expect(api.shortcuts.get()).resolves.toEqual(realBindings);

    // A partially-present group keeps its real members and fills the rest.
    await expect(api.mode.get()).resolves.toBe('voice');
    expect(typeof api.mode.onChanged).toBe('function');
    expect(api.mode.onChanged(() => {})).toEqual(expect.any(Function));

    // A fully-missing group falls back to safe defaults.
    await expect(api.config.get()).resolves.toMatchObject({ mode: 'desktop' });
    expect(typeof api.config.onChanged).toBe('function');

    // Fire-and-forget commands exist and are inert.
    expect(() => api.window.minimize()).not.toThrow();
    expect(() => api.overlay.resize(400, 300)).not.toThrow();
  });
});
