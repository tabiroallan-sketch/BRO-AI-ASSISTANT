import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type DesktopApi,
  type DesktopConfig,
  type PickFileResult,
  type ServerReport,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutSetResult,
  type ThemeSource,
  type UpdateStatus,
} from '../shared/desktop-api.js';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const apiArg = process.argv.find((arg) => arg.startsWith('--bro-api-url='));
const apiBaseUrl = apiArg ? apiArg.slice('--bro-api-url='.length) : '';

const api: DesktopApi = {
  platform: process.platform,
  isPackaged: process.argv.includes('--bro-packaged'),
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (patch) => ipcRenderer.invoke(IPC.configSet, patch),
    onChanged: (callback) => subscribe<DesktopConfig>(IPC.configChanged, callback),
  },
  window: {
    minimize: () => void ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => void ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => void ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximized: (callback) => subscribe<boolean>(IPC.windowMaximized, callback),
    navigate: (path) => void ipcRenderer.invoke(IPC.windowNavigate, path),
  },
  commands: {
    onMicToggle: (callback) => subscribe(IPC.micToggle, callback),
    onListeningStart: (callback) => subscribe(IPC.listeningStart, callback),
    onListeningStop: (callback) => subscribe(IPC.listeningStop, callback),
    onPushToTalkStart: (callback) => subscribe(IPC.pushToTalkStart, callback),
    onPushToTalkStop: (callback) => subscribe(IPC.pushToTalkStop, callback),
  },
  overlay: {
    toggle: () => void ipcRenderer.invoke(IPC.overlayToggle),
    hide: () => void ipcRenderer.invoke(IPC.overlayHide),
    onToggle: (callback) => subscribe(IPC.overlayToggle, callback),
    onHide: (callback) => subscribe(IPC.overlayHide, callback),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
    openPath: (target) => ipcRenderer.invoke(IPC.shellOpenPath, target),
  },
  dialog: {
    pickFile: () => ipcRenderer.invoke(IPC.dialogPickFile) as Promise<PickFileResult>,
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  },
  shortcuts: {
    register: (id, accelerator) => ipcRenderer.invoke(IPC.shortcutsRegister, id, accelerator),
    unregister: (id) => ipcRenderer.invoke(IPC.shortcutsUnregister, id),
    onTriggered: (callback) => subscribe<string>(IPC.shortcutsTriggered, callback),
    get: () => ipcRenderer.invoke(IPC.shortcutsGet) as Promise<ShortcutBindings>,
    set: (action: ShortcutAction, accelerator: string) =>
      ipcRenderer.invoke(IPC.shortcutsSet, action, accelerator) as Promise<ShortcutSetResult>,
    onChanged: (callback) => subscribe<ShortcutBindings>(IPC.shortcutsChanged, callback),
  },
  autostart: {
    isEnabled: () => ipcRenderer.invoke(IPC.autostartIsEnabled),
    set: (enabled, hidden) => ipcRenderer.invoke(IPC.autostartSet, enabled, hidden),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onStatus: (callback) => subscribe<UpdateStatus>(IPC.updatesChanged, callback),
  },
  servers: {
    status: () => ipcRenderer.invoke(IPC.serversStatus),
    restart: (id) => ipcRenderer.invoke(IPC.serversRestart, id),
    onStatus: (callback) => subscribe<ServerReport[]>(IPC.serversChanged, callback),
  },
  notifications: {
    show: (title, body) => void ipcRenderer.invoke(IPC.notificationShow, title, body),
  },
  network: {
    isOnline: () => ipcRenderer.invoke(IPC.networkStatus),
    onStatus: (callback) => subscribe<boolean>(IPC.networkChanged, callback),
  },
  theme: {
    get: () => ipcRenderer.invoke(IPC.themeGet) as Promise<ThemeSource>,
    onChange: (callback) => subscribe<boolean>(IPC.themeChanged, callback),
  },
};

contextBridge.exposeInMainWorld('broDesktop', api);
if (apiBaseUrl) {
  contextBridge.exposeInMainWorld('__BRO_API_URL__', apiBaseUrl);
}
