import type { Tool } from '../types.js';
import { processOps } from './ops.js';

export const systemLaunchAppTool: Tool = {
  name: 'system_launch_app',
  description:
    'Launch a desktop application on the user\'s computer. "name" can be a full path to an executable (e.g. "C:\\Program Files\\Notepad++\\notepad++.exe"), a folder path, a document, or a well-known app name. Non-destructive; no confirmation needed.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Path or name of the application or file to launch.' },
    },
    required: ['name'],
  },
  async execute(args) {
    const name = typeof args.name === 'string' ? args.name : '';
    return processOps.launchApp(name);
  },
};

export const systemTerminateAppTool: Tool = {
  name: 'system_terminate_app',
  description:
    'Terminate a running application by process name (e.g. "notepad.exe"). Use system_list_processes first to find the exact name. Requires explicit user confirmation before it runs.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Process name including extension, e.g. "notepad.exe".',
      },
      force: {
        type: 'boolean',
        description: 'Force-quit even if the process has unsaved state (default false).',
      },
    },
    required: ['name'],
  },
  requireConfirmation: true,
  async execute(args) {
    const name = typeof args.name === 'string' ? args.name : '';
    const force = args.force === true;
    return processOps.terminateApp(name, force);
  },
};

export const systemListProcessesTool: Tool = {
  name: 'system_list_processes',
  description:
    "List the applications and processes currently running on the user's computer (id, process name and window title when present). Use this before system_terminate_app or the window tools to find exact process names, ids or window titles.",
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of processes to return (default 50, max 200).',
      },
    },
  },
  async execute(args) {
    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const { processes, source } = await processOps.listProcesses(limit);
    if (source === 'unsupported') {
      return 'Process listing is only supported on Windows.';
    }
    if (processes.length === 0) {
      return 'No running processes were found.';
    }
    return processes
      .map(
        (process) =>
          `[${process.id}] ${process.name}${process.windowTitle ? ` — "${process.windowTitle}"` : ''}`,
      )
      .join('\n');
  },
};
