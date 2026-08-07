import { autoUpdater as defaultUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/desktop-api.js';

export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: never[]) => void): void;
};

export type UpdateManagerOptions = {
  isEnabled: () => boolean;
  onStatus: (status: UpdateStatus) => void;
  updater?: UpdaterLike;
};

/**
 * Wraps electron-updater. The updater is only active in packaged builds (and
 * only when a GitHub release feed is configured); in development it reports
 * `disabled`. Status flows to the renderer over IPC.
 *
 * The electron-updater instance is resolved lazily so that importing this
 * module (or constructing an UpdateManager that never enables) does not pull
 * in Electron-only globals outside of the main process.
 */
export class UpdateManager {
  private readonly options: UpdateManagerOptions;
  private updater: UpdaterLike | null = null;
  private status: UpdateStatus = { state: 'disabled' };

  constructor(options: UpdateManagerOptions) {
    this.options = options;
  }

  private getUpdater(): UpdaterLike {
    if (!this.updater) {
      this.updater = this.options.updater ?? defaultUpdater;
      this.updater.autoDownload = true;
      this.updater.autoInstallOnAppQuit = true;
    }
    return this.updater;
  }

  init(): void {
    if (!this.options.isEnabled()) {
      this.setStatus({ state: 'disabled' });
      return;
    }
    const updater = this.getUpdater();
    updater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    updater.on('update-available', (info: { version?: string }) =>
      this.setStatus({ state: 'available', version: info.version }),
    );
    updater.on('update-not-available', (info: { version?: string }) =>
      this.setStatus({ state: 'not-available', version: info.version }),
    );
    updater.on('download-progress', (progress: { percent?: number }) =>
      this.setStatus({ state: 'downloading', percent: progress.percent ?? 0 }),
    );
    updater.on('update-downloaded', (info: { version?: string }) =>
      this.setStatus({ state: 'downloaded', version: info.version }),
    );
    updater.on('error', (error: Error) =>
      this.setStatus({ state: 'error', message: error.message }),
    );
    this.setStatus({ state: 'idle' });
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.options.isEnabled()) {
      this.setStatus({ state: 'disabled' });
      return this.status;
    }
    try {
      await this.getUpdater().checkForUpdates();
    } catch (error) {
      this.setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.status;
  }

  async download(): Promise<void> {
    if (!this.options.isEnabled()) {
      return;
    }
    await this.getUpdater().downloadUpdate();
  }

  install(): void {
    if (!this.options.isEnabled()) {
      return;
    }
    this.getUpdater().quitAndInstall();
  }
}
