import { clipboard, dialog, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import type { PickFileResult } from '../shared/desktop-api.js';

export type NativeBridge = {
  readClipboardText(): string;
  writeClipboardText(text: string): void;
  pickFile(parent: Electron.BrowserWindow | null): Promise<PickFileResult>;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<string>;
};

/**
 * Thin wrappers over Electron's native modules. Kept here (not in the IPC
 * handler) so the surfaces stay small, typed, and easy to test.
 */
export function createNativeBridge(): NativeBridge {
  return {
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text) => clipboard.writeText(text),
    pickFile: async (parent) => {
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        title: 'Select a file for BRO',
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const path = result.filePaths[0]!;
      try {
        const content = await readFile(path, 'utf8');
        return { canceled: false, path, content };
      } catch {
        return { canceled: false, path, content: '' };
      }
    },
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
    openPath: (target) => shell.openPath(target),
  };
}
