import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { MainWindow } from './windows.js';

export type TrayOptions = {
  iconPath?: string;
  onOpenDashboard: () => void;
  onOpenOverlay: () => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onQuit: () => void;
  /** Current listening state, read when the menu is rebuilt. */
  listening: () => boolean;
};

/**
 * System tray icon with quick actions. The tray is what keeps BRO reachable
 * when the window is hidden - Stage 2's background service lives here: quick
 * actions for the dashboard, overlay, and voice listening, plus quit.
 */
export class AppTray {
  private tray: Tray | null = null;
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
    this.rebuild(mainWindow);
    tray.on('click', () => mainWindow.focus());
  }

  /** Rebuilds the context menu so it reflects the current listening state. */
  setListening(mainWindow: MainWindow, listening: boolean): void {
    this.options.listening = () => listening;
    if (this.tray) {
      this.rebuild(mainWindow);
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private rebuild(mainWindow: MainWindow): void {
    if (!this.tray) {
      return;
    }
    const listening = this.options.listening();
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
