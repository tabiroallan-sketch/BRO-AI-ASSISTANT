import { app, Menu } from 'electron';
import type { ThemeSource } from '../shared/desktop-api.js';

export type AppMenusOptions = {
  getTheme: () => Promise<ThemeSource>;
  setTheme: (source: ThemeSource) => void;
  onOpenSettings: () => void;
  onOpenDevTools: () => void;
};

type MenuItem = Electron.MenuItemConstructorOptions;

/**
 * Native application menu. Includes the standard edit roles (clipboard,
 * select-all) so keyboard shortcuts work in text fields, plus theme and
 * settings entries wired to the same preferences the web UI edits.
 */
export function installApplicationMenu(options: AppMenusOptions): void {
  const buildTemplate = (currentTheme: ThemeSource): MenuItem[] => [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => options.onOpenSettings(),
        },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${app.getName()}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Appearance',
          submenu: [
            {
              label: 'System',
              type: 'radio',
              checked: currentTheme === 'system',
              click: () => options.setTheme('system'),
            },
            {
              label: 'Light',
              type: 'radio',
              checked: currentTheme === 'light',
              click: () => options.setTheme('light'),
            },
            {
              label: 'Dark',
              type: 'radio',
              checked: currentTheme === 'dark',
              click: () => options.setTheme('dark'),
            },
          ],
        },
        { type: 'separator' },
        { role: 'reload' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => options.onOpenDevTools(),
        },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [{ role: 'about', label: `About ${app.getName()}` }],
    },
  ];

  const apply = (theme: ThemeSource): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(theme)));
  };

  void options
    .getTheme()
    .then(apply)
    .catch(() => apply('system'));
}
