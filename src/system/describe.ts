function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Human-readable description of a pending system action, shown to the user
 * when BRO asks for confirmation before executing it.
 */
export function describeAction(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'system_terminate_app': {
      const name = str(args.name);
      return `Terminate the process "${name}"${args.force ? ' (force)' : ''}`;
    }
    case 'system_run_command': {
      return `Run the shell command: ${str(args.command)}`;
    }
    case 'system_run_script': {
      const runtime = str(args.runtime) || 'npm';
      return `Run the ${runtime} script "${str(args.script)}"${str(args.cwd) ? ` in ${str(args.cwd)}` : ' in the BRO directory'}`;
    }
    case 'system_rename': {
      return `Rename or move "${str(args.source)}" to "${str(args.destination)}"`;
    }
    case 'system_delete': {
      return `Delete "${str(args.path)}" (moved to the Recycle Bin)`;
    }
    case 'system_create_folder': {
      return `Create the folder "${str(args.path)}"`;
    }
    case 'system_launch_app': {
      return `Launch the application "${str(args.name)}"`;
    }
    case 'system_open_browser': {
      return `Open ${str(args.url)} in the default browser`;
    }
    case 'system_open_editor': {
      return `Open ${str(args.path) || 'the current directory'} in VS Code`;
    }
    case 'system_open_terminal': {
      return `Open a terminal${str(args.path) ? ` in ${str(args.path)}` : ''}`;
    }
    case 'system_write_clipboard': {
      return 'Copy text to the OS clipboard';
    }
    case 'system_focus_window': {
      return args.id
        ? `Focus the window with id ${String(args.id)}`
        : `Focus the window titled "${str(args.title)}"`;
    }
    case 'system_minimize_window': {
      return args.id
        ? `Minimize the window with id ${String(args.id)}`
        : `Minimize the window titled "${str(args.title)}"`;
    }
    default:
      return `${toolName}${Object.keys(args).length > 0 ? ` with ${JSON.stringify(args)}` : ''}`;
  }
}
