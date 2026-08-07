import type { Tool } from '../types.js';
import { windowOps } from './ops.js';

function targetOf(args: Record<string, unknown>): { id?: number; title?: string } {
  if (typeof args.id === 'number' && args.id > 0) {
    return { id: args.id };
  }
  return typeof args.title === 'string' && args.title.trim() ? { title: args.title } : {};
}

export const systemListWindowsTool: Tool = {
  name: 'system_list_windows',
  description:
    "List the open application windows on the user's computer (id, process name and window title). Use this before system_focus_window or system_minimize_window to find the id or title to target. Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute() {
    const windows = await windowOps.listWindows();
    if (windows.length === 0) {
      return 'No application windows were found.';
    }
    return windows
      .map((window) => `[${window.id}] ${window.process} — "${window.title}"`)
      .join('\n');
  },
};

export const systemFocusWindowTool: Tool = {
  name: 'system_focus_window',
  description:
    "Bring an application window to the foreground on the user's computer. Provide either the window id or the window title (from system_list_windows). Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Window id from system_list_windows.' },
      title: { type: 'string', description: 'Window title from system_list_windows.' },
    },
  },
  async execute(args) {
    return windowOps.focusWindow(targetOf(args));
  },
};

export const systemMinimizeWindowTool: Tool = {
  name: 'system_minimize_window',
  description:
    "Minimize an application window on the user's computer. Provide either the window id or the window title (from system_list_windows). Non-destructive; no confirmation needed.",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Window id from system_list_windows.' },
      title: { type: 'string', description: 'Window title from system_list_windows.' },
    },
  },
  async execute(args) {
    return windowOps.minimizeWindow(targetOf(args));
  },
};
