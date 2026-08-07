import { createRunner } from '../../system/exec.js';
import { createClipboardOps } from '../../system/clipboard.js';
import { createFileOps } from '../../system/files.js';
import { createLauncherOps } from '../../system/launchers.js';
import { createProcessOps } from '../../system/process.js';
import { createWindowOps } from '../../system/window.js';

/**
 * System tool dependencies. The system layer is built on an injectable Runner
 * so it can be unit-tested with a fake; here the real node:child_process
 * implementation is wired once and shared by every system tool.
 */
const runner = createRunner();

export const processOps = createProcessOps(runner);
export const fileOps = createFileOps(runner);
export const windowOps = createWindowOps(runner);
export const clipboardOps = createClipboardOps(runner);
export const launcherOps = createLauncherOps(runner);
