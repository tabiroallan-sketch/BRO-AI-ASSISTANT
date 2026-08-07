import { describe, expect, it, vi } from 'vitest';
import { UpdateManager, type UpdaterLike } from '../src/main/updater.js';

function makeUpdater() {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const updater: UpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) {
      (listener as (...args: unknown[]) => void)(...args);
    }
  };
  return { updater, emit };
}

describe('UpdateManager', () => {
  it('is disabled when updates are not enabled', () => {
    const onStatus = vi.fn();
    const manager = new UpdateManager({ isEnabled: () => false, onStatus });
    manager.init();
    expect(manager.getStatus()).toEqual({ state: 'disabled' });
    expect(onStatus).toHaveBeenCalledWith({ state: 'disabled' });
  });

  it('starts idle and reports lifecycle events', async () => {
    const { updater, emit } = makeUpdater();
    const onStatus = vi.fn();
    const manager = new UpdateManager({ isEnabled: () => true, onStatus, updater });
    manager.init();
    emit('checking-for-update');
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'checking' });
    emit('update-available', { version: '1.2.3' });
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'available', version: '1.2.3' });
    emit('download-progress', { percent: 42 });
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'downloading', percent: 42 });
    emit('update-downloaded', { version: '1.2.3' });
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'downloaded', version: '1.2.3' });
  });

  it('check() invokes the upstream updater and reports errors', async () => {
    const { updater, emit } = makeUpdater();
    const onStatus = vi.fn();
    const manager = new UpdateManager({ isEnabled: () => true, onStatus, updater });
    manager.init();
    await manager.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    emit('error', new Error('feed unreachable'));
    expect(manager.getStatus()).toEqual({ state: 'error', message: 'feed unreachable' });
  });

  it('check() swallows upstream failures into an error status', async () => {
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn().mockRejectedValue(new Error('boom')),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
    };
    const manager = new UpdateManager({ isEnabled: () => true, onStatus: vi.fn(), updater });
    const status = await manager.check();
    expect(status).toEqual({ state: 'error', message: 'boom' });
  });

  it('download and install are no-ops when disabled', async () => {
    const { updater } = makeUpdater();
    const manager = new UpdateManager({ isEnabled: () => false, onStatus: vi.fn(), updater });
    await manager.download();
    manager.install();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
