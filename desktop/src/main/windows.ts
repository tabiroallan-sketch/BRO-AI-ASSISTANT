import { BrowserWindow, screen, shell } from 'electron';
import { IPC } from '../shared/desktop-api.js';
import { WindowStateStore, type WindowState } from './window-state.js';

export type MainWindowOptions = {
  preloadPath: string;
  iconPath?: string;
  stateStore: WindowStateStore;
  /** Base URL of the API including the /api/v1 suffix (injected at runtime). */
  apiBaseUrl: string;
  /** True when closing the window should hide it to the tray instead of quitting. */
  closeToTray: () => boolean;
  isQuitting: () => boolean;
  onQuitRequested: () => void;
};

const STATE_SAVE_DELAY_MS = 500;

/**
 * The primary BRO window. Loads the bundled web app, applies persisted bounds,
 * keeps the bounds up to date, and hands external navigations to the OS
 * browser so the app never loses its own frame.
 */
export class MainWindow {
  private window: BrowserWindow | null = null;
  private readonly options: MainWindowOptions;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MainWindowOptions) {
    this.options = options;
  }

  get instance(): BrowserWindow | null {
    return this.window;
  }

  create(url: string): void {
    const { stateStore, preloadPath, iconPath, apiBaseUrl } = this.options;
    const displays = screen.getAllDisplays().map((display) => display.workArea);
    const state = stateStore.load(displays);

    const window = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: 640,
      minHeight: 480,
      show: false,
      autoHideMenuBar: false,
      backgroundColor: '#05060b',
      icon: iconPath,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        additionalArguments: [`--bro-api-url=${apiBaseUrl}`],
      },
    });
    this.window = window;

    if (state.maximized) {
      window.maximize();
    }
    if (state.fullscreen) {
      window.setFullScreen(true);
    }

    window.once('ready-to-show', () => {
      window.show();
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, targetUrl) => {
      if (!targetUrl.startsWith(url)) {
        event.preventDefault();
        void shell.openExternal(targetUrl);
      }
    });

    const scheduleSave = (): void => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }
      this.saveTimer = setTimeout(() => this.saveState(), STATE_SAVE_DELAY_MS);
    };
    window.on('move', scheduleSave);
    window.on('resize', scheduleSave);
    window.on('maximize', () => this.send(IPC.windowMaximized, true));
    window.on('unmaximize', () => this.send(IPC.windowMaximized, false));
    window.on('enter-full-screen', scheduleSave);
    window.on('leave-full-screen', scheduleSave);
    window.on('close', () => {
      this.saveState();
      if (this.options.closeToTray() && !this.options.isQuitting()) {
        window.hide();
      }
    });

    window.on('closed', () => {
      this.window = null;
    });

    void window.loadURL(url);
  }

  private saveState(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) {
      return;
    }
    const bounds = window.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
    };
    this.options.stateStore.save(state);
  }

  send(channel: string, payload?: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  focus(): void {
    const window = this.window;
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  isVisible(): boolean {
    return this.window !== null && this.window.isVisible();
  }

  minimize(): void {
    this.window?.minimize();
  }

  toggleMaximize(): void {
    if (!this.window) {
      return;
    }
    if (this.window.isMaximized()) {
      this.window.unmaximize();
    } else {
      this.window.maximize();
    }
  }

  close(): void {
    this.options.onQuitRequested();
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }
}
