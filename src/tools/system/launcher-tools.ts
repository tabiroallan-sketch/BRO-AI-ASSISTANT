import type { Tool } from '../types.js';
import { launcherOps } from './ops.js';

export const systemOpenBrowserTool: Tool = {
  name: 'system_open_browser',
  description:
    "Open a URL in the user's default web browser. Only http/https URLs are allowed. Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The http or https URL to open.' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = typeof args.url === 'string' ? args.url : '';
    return launcherOps.openBrowser(url);
  },
};

export const systemOpenEditorTool: Tool = {
  name: 'system_open_editor',
  description:
    "Open VS Code on the user's computer, optionally at a given folder or file path. Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional folder or file to open in VS Code.' },
    },
  },
  async execute(args) {
    const path = typeof args.path === 'string' && args.path.trim() ? args.path : undefined;
    return launcherOps.openEditor(path);
  },
};

export const systemOpenTerminalTool: Tool = {
  name: 'system_open_terminal',
  description:
    "Open a terminal window on the user's computer, optionally in a given directory. Uses Windows Terminal when available, falling back to cmd. Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional directory to open the terminal in.' },
    },
  },
  async execute(args) {
    const path = typeof args.path === 'string' && args.path.trim() ? args.path : undefined;
    return launcherOps.openTerminal(path);
  },
};
