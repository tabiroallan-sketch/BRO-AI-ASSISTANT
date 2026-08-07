import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WindowStateStore,
  isVisibleOnScreen,
  normalizeWindowState,
} from '../src/main/window-state.js';

describe('normalizeWindowState', () => {
  it('fills defaults for missing fields', () => {
    const state = normalizeWindowState(null);
    expect(state.width).toBe(1280);
    expect(state.height).toBe(820);
    expect(state.maximized).toBe(false);
    expect(state.fullscreen).toBe(false);
  });

  it('clamps absurd sizes', () => {
    const state = normalizeWindowState({ width: 999999, height: -5, x: 1.5, y: 2.5 });
    expect(state.width).toBe(100_000);
    expect(state.height).toBe(400);
    expect(state.x).toBe(1);
    expect(state.y).toBe(2);
  });

  it('ignores non-numeric coordinates', () => {
    const state = normalizeWindowState({ x: 'a', y: null });
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
  });
});

describe('isVisibleOnScreen', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  it('detects overlap with a display', () => {
    expect(isVisibleOnScreen({ x: 100, y: 100, width: 800, height: 600 }, displays)).toBe(true);
  });

  it('rejects bounds fully off-screen', () => {
    expect(isVisibleOnScreen({ x: 5000, y: 5000, width: 800, height: 600 }, displays)).toBe(false);
  });

  it('rejects missing coordinates', () => {
    expect(isVisibleOnScreen({ width: 800, height: 600 }, displays)).toBe(false);
  });
});

describe('WindowStateStore', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  it('round-trips saved bounds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bro-window-'));
    const file = join(dir, 'window-state.json');
    const store = new WindowStateStore({ filePath: file });
    store.save({ x: 40, y: 50, width: 1200, height: 700, maximized: true, fullscreen: false });
    expect(store.load(displays)).toEqual({
      x: 40,
      y: 50,
      width: 1200,
      height: 700,
      maximized: true,
      fullscreen: false,
    });
    rmSync(dir, { recursive: true });
  });

  it('drops off-screen positions but keeps the size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bro-window-'));
    const file = join(dir, 'window-state.json');
    writeFileSync(
      file,
      JSON.stringify({
        x: 9000,
        y: 9000,
        width: 1100,
        height: 600,
        maximized: false,
        fullscreen: false,
      }),
      'utf8',
    );
    const store = new WindowStateStore({ filePath: file });
    const state = store.load(displays);
    expect(state.width).toBe(1100);
    expect(state.height).toBe(600);
    expect(state.x).toBeUndefined();
    rmSync(dir, { recursive: true });
  });

  it('returns defaults when no file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bro-window-'));
    const store = new WindowStateStore({ filePath: join(dir, 'missing.json') });
    expect(store.load(displays)).toEqual({
      width: 1280,
      height: 820,
      maximized: false,
      fullscreen: false,
    });
    rmSync(dir, { recursive: true });
  });
});
