import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
};

export type Display = { x: number; y: number; width: number; height: number };

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;
const MIN_SIZE = 400;
const MAX_SIZE = 100_000;

export function normalizeWindowState(raw: unknown): WindowState {
  const value = typeof raw === 'object' && raw !== null ? (raw as Partial<WindowState>) : {};
  const clamp = (n: number | undefined, fallback: number): number => {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(n)));
  };
  const intCoord = (n: number | undefined): number | undefined => {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return undefined;
    }
    return Math.trunc(n);
  };
  return {
    x: intCoord(value.x),
    y: intCoord(value.y),
    width: clamp(value.width, DEFAULT_WIDTH),
    height: clamp(value.height, DEFAULT_HEIGHT),
    maximized: value.maximized === true,
    fullscreen: value.fullscreen === true,
  };
}

/** True when at least part of the saved bounds intersects a display. */
export function isVisibleOnScreen(
  bounds: { x?: number; y?: number; width: number; height: number },
  displays: Display[],
): boolean {
  if (bounds.x === undefined || bounds.y === undefined) {
    return false;
  }
  return displays.some((display) => {
    const overlapX = bounds.x! < display.x + display.width && bounds.x! + bounds.width > display.x;
    const overlapY =
      bounds.y! < display.y + display.height && bounds.y! + bounds.height > display.y;
    return overlapX && overlapY;
  });
}

/**
 * Persists the main window bounds between launches. Pure file I/O only, so it
 * is unit-testable without Electron; the caller supplies the display list for
 * the on-screen validation.
 */
export class WindowStateStore {
  private readonly filePath: string;

  constructor(options: { filePath: string }) {
    this.filePath = options.filePath;
  }

  load(displays: Display[]): WindowState {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
    } catch {
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false, fullscreen: false };
    }
    const state = normalizeWindowState(raw);
    if (!isVisibleOnScreen(state, displays)) {
      return {
        width: state.width,
        height: state.height,
        maximized: state.maximized,
        fullscreen: false,
      };
    }
    return state;
  }

  save(state: WindowState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}
