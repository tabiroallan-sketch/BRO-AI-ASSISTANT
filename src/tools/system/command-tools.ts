import type { Tool } from '../types.js';
import { processOps } from './ops.js';

export const systemRunCommandTool: Tool = {
  name: 'system_run_command',
  description:
    "Run a shell command on the user's computer (cmd on Windows, the default shell elsewhere) in the BRO directory unless a different working directory is given. Output is returned, capped at 8000 characters. Powerful: requires explicit user confirmation before it runs. Prefer system_run_script for package.json scripts.",
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run, e.g. "dir" or "ls -la".' },
      cwd: {
        type: 'string',
        description: 'Optional working directory for the command.',
      },
    },
    required: ['command'],
  },
  requireConfirmation: true,
  async execute(args) {
    const command = typeof args.command === 'string' ? args.command : '';
    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : undefined;
    return processOps.runShellCommand(command, cwd ? { cwd } : undefined);
  },
};

export const systemRunScriptTool: Tool = {
  name: 'system_run_script',
  description:
    'Run an npm or bun package.json script on the user\'s computer, e.g. "npm run build" or "bun run dev". Takes the runtime (npm or bun) and the script name. Requires explicit user confirmation before it runs.',
  parameters: {
    type: 'object',
    properties: {
      runtime: {
        type: 'string',
        description: 'Package manager to use: "npm" or "bun".',
      },
      script: {
        type: 'string',
        description: 'Name of the script to run, e.g. "build", "test", "dev".',
      },
      cwd: {
        type: 'string',
        description: 'Optional directory containing package.json (defaults to the BRO directory).',
      },
    },
    required: ['runtime', 'script'],
  },
  requireConfirmation: true,
  async execute(args) {
    const runtime = args.runtime === 'bun' ? 'bun' : 'npm';
    const script = typeof args.script === 'string' ? args.script : '';
    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : undefined;
    return processOps.runScript(runtime, script, cwd ? { cwd } : undefined);
  },
};
