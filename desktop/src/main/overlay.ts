import { BrowserWindow, screen, shell } from 'electron';
import { type OverlayBounds } from '../shared/desktop-api.js';
import { clampOverlayBounds, defaultOverlayBounds, type Rect } from './overlay-bounds.js';

export type OverlayWindowOptions = {
  /** Base URL of the bundled web app; the overlay loads `<webUrl>/overlay`. */
  webUrl: string;
  preloadPath: string;
  apiBaseUrl: string;
  /** Persisted bounds from config, or null when the overlay was never shown. */
  getBounds: () => OverlayBounds | null;
  /** Persists the overlay's position/size after a move or resize. */
  saveBounds: (bounds: OverlayBounds) => void;
  /** Fired when the window shows or hides (for the renderer bridge). */
  onVisibility: (visible: boolean) => void;
};

const BOUNDS_SAVE_DELAY_MS = 300;

/**
 * The floating assistant (Stage 4): a frameless, transparent, always-on-top
 * window over the `/overlay` route. It is created lazily on first summon,
 * cached, and hidden (never destroyed) while idle so summoning stays instant
 * and hidden windows are not rendered by Chromium.
 */
export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private readonly options: OverlayWindowOptions;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OverlayWindowOptions) {
    this.options = options;
  }

  get instance(): BrowserWindow | null {
    return this.window;
  }

  isVisible(): boolean {
    return this.window !== null && this.window.isVisible();
  }

  /** Lazily creates the window (once) and shows it. */
  show(): void {
    const window = this.ensureWindow();
    if (!window.isVisible()) {
      window.show();
      window.focus();
    }
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  toggle(): void {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Resizes the overlay while keeping its top-left corner fixed. */
  resize(width: number, height: number): void {
    const window = this.window;
    if (!window || window.isDestroyed()) {
      return;
    }
    const bounds = window.getBounds();
    const [nextWidth, nextHeight] = this.fitSize(width, height);
    window.setBounds({ x: bounds.x, y: bounds.y, width: nextWidth, height: nextHeight });
  }

  send(channel: string, payload?: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }
    return this.createWindow();
  }

  private createWindow(): BrowserWindow {
    const { webUrl, preloadPath, apiBaseUrl } = this.options;
    const workArea = this.workArea();
    const persisted = this.options.getBounds();
    const bounds = persisted
      ? clampOverlayBounds(persisted, workArea)
      : defaultOverlayBounds(workArea);

    const window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 300,
      minHeight: 240,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: true,
        additionalArguments: [`--bro-api-url=${apiBaseUrl}`],
      },
    });
    this.window = window;

    window.on('show', () => this.options.onVisibility(true));
    window.on('hide', () => this.options.onVisibility(false));
    window.on('closed', () => {
      this.window = null;
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (!targetUrl.startsWith(webUrl)) {
        event.preventDefault();
        void shell.openExternal(targetUrl);
      }
    });

    const scheduleSave = (): void => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => this.saveBounds(), BOUNDS_SAVE_DELAY_MS);
    };
    window.on('move', scheduleSave);
    window.on('resize', scheduleSave);

    void window.loadURL(`${webUrl}/overlay`);
    return window;
  }

  /** The display containing the cursor; the main display if unavailable. */
  private workArea(): Rect {
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      return display.workArea;
    } catch {
      return screen.getPrimaryDisplay().workArea;
    }
  }

  private fitSize(width: number, height: number): [number, number] {
    const workArea = this.workArea();
    const nextWidth = Math.max(300, Math.min(width, workArea.width));
    const nextHeight = Math.max(240, Math.min(height, workArea.height));
    return [Math.round(nextWidth), Math.round(nextHeight)];
  }

  private saveBounds(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) {
      return;
    }
    const bounds = window.getBounds();
    this.options.saveBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
}
