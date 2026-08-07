import { app, Menu, Tray, nativeImage } from 'electron';
import { IPC } from '../shared/desktop-api.js';
import type { MainWindow } from './windows.js';

export type TrayOptions = {
  iconPath?: string;
  onQuit: () => void;
};

/**
 * System tray icon with quick actions. The tray is what keeps BRO reachable
 * when the window is hidden (background service work lands in Stage 2).
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

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open BRO',
        click: () => mainWindow.focus(),
      },
      {
        label: 'Open Dashboard',
        click: () => {
          mainWindow.focus();
          mainWindow.send(IPC.windowNavigate, '/dashboard');
        },
      },
      { type: 'separator' },
      {
        label: 'Start Listening',
        enabled: false,
        toolTip: 'Voice arrives in a later milestone',
      },
      {
        label: 'Stop Listening',
        enabled: false,
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
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => mainWindow.focus());
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
