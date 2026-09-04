import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import {
  OPERATING_MODE_LABELS,
  OPERATING_MODES,
  type OperatingMode,
} from '../shared/desktop-api.js';
import type { MainWindow } from './windows.js';

export type TrayOptions = {
  iconPath?: string;
  onOpenDashboard: () => void;
  onOpenOverlay: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onToggleWakeWord: () => void;
  onSetMode: (mode: OperatingMode) => void;
  onQuit: () => void;
  /** Current listening state, read when the menu is rebuilt. */
  listening: () => boolean;
  /** Current wake-word state, read when the menu is rebuilt. */
  wakeWord: () => boolean;
  /** Current operating mode, read when the menu is rebuilt. */
  mode: () => OperatingMode;
};

/**
 * System tray icon with quick actions. The tray is what keeps BRO reachable
 * when the window is hidden - Stage 2's background service lives here: quick
 * actions for the dashboard, overlay, and voice listening, plus quit.
 */
export class AppTray {
  private tray: Tray | null = null;
  private mainWindow: MainWindow | null = null;
  private readonly options: TrayOptions;

  constructor(options: TrayOptions) {
    this.options = options;
  }

  create(mainWindow: MainWindow): void {
    const image = this.options.iconPath
      ? nativeImage.createFromPath(this.options.iconPath)
      : nativeImage.createEmpty();
    const tray = new Tray(image);
    tray.setToolTip('BRO - AI Operating System');
    this.tray = tray;
    this.mainWindow = mainWindow;
    this.rebuild();
    tray.on('click', () => mainWindow.focus());
  }

  /** Rebuilds the context menu so it reflects the current listening state. */
  setListening(listening: boolean): void {
    this.options.listening = (): boolean => listening;
    this.rebuild();
  }

  /** Rebuilds the context menu so it reflects the current wake-word state. */
  setWakeWord(wakeWord: boolean): void {
    this.options.wakeWord = (): boolean => wakeWord;
    this.rebuild();
  }

  /** Rebuilds the context menu so it reflects the current operating mode. */
  setMode(mode: OperatingMode): void {
    this.options.mode = (): OperatingMode => mode;
    this.rebuild();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
    this.mainWindow = null;
  }

  private rebuild(): void {
    if (!this.tray || !this.mainWindow) {
      return;
    }
    const mainWindow = this.mainWindow;
    const listening = this.options.listening();
    const wakeWord = this.options.wakeWord();
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Open BRO',
        click: () => mainWindow.focus(),
      },
      {
        label: 'Open Dashboard',
        click: () => this.options.onOpenDashboard(),
      },
      {
        label: 'Open Overlay',
        click: () => this.options.onOpenOverlay(),
      },
      {
        label: 'Mode',
        submenu: OPERATING_MODES.map((mode) => ({
          label: OPERATING_MODE_LABELS[mode],
          type: 'radio' as const,
          checked: this.options.mode() === mode,
          click: () => this.options.onSetMode(mode),
        })),
      },
      { type: 'separator' },
      {
        label: 'Start Listening',
        enabled: !listening,
        click: () => this.options.onStartListening(),
      },
      {
        label: 'Stop Listening',
        enabled: listening,
        click: () => this.options.onStopListening(),
      },
      {
        label: wakeWord ? 'Wake word: On' : 'Wake word: Off',
        click: () => this.options.onToggleWakeWord(),
      },
      { type: 'separator' },
      {
        label: `About ${app.getName()}`,
        click: () => mainWindow.focus(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.options.onQuit(),
      },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }
}
