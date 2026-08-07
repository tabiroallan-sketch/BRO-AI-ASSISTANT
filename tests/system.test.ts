import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipboardOps } from '../src/system/clipboard.js';
import {
  clearConfirmations,
  createPendingAction,
  decideAction,
  expireStale,
  listActionsForUser,
} from '../src/system/confirmation-store.js';
import { describeAction } from '../src/system/describe.js';
import { createFileOps } from '../src/system/files.js';
import { createLauncherOps } from '../src/system/launchers.js';
import { createProcessOps } from '../src/system/process.js';
import { createWindowOps } from '../src/system/window.js';
import type { ExecResult, Runner } from '../src/system/types.js';

type Call = {
  kind: 'execFile' | 'shell';
  file?: string;
  args?: string[];
  command?: string;
  options?: { cwd?: string; timeoutMs?: number };
};

function fakeRunner(): Runner & {
  calls: Call[];
  respond: (result: Partial<ExecResult>) => void;
} {
  const calls: Call[] = [];
  let last: ExecResult = { code: 0, stdout: '', stderr: '' };
  const queue: ExecResult[] = [];
  return {
    calls,
    respond(result: Partial<ExecResult>): void {
      last = { code: 0, stdout: '', stderr: '', ...result };
      queue.push(last);
    },
    async execFile(file, args, options) {
      calls.push({ kind: 'execFile', file, args, options });
      return queue.length > 0 ? (queue.shift() as ExecResult) : last;
    },
    async shell(command, options) {
      calls.push({ kind: 'shell', command, options });
      return queue.length > 0 ? (queue.shift() as ExecResult) : last;
    },
  };
}

describe('system process ops', () => {
  it('launches an app with cmd start on Windows', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createProcessOps(runner, 'win32');

    await expect(ops.launchApp('notepad.exe')).resolves.toBe('Launched notepad.exe.');
    expect(runner.calls[0]).toEqual({
      kind: 'execFile',
      file: 'cmd.exe',
      args: ['/c', 'start', '', 'notepad.exe'],
      options: { timeoutMs: 10_000 },
    });
  });

  it('rejects an empty app target', async () => {
    const ops = createProcessOps(fakeRunner(), 'win32');
    await expect(ops.launchApp('   ')).rejects.toThrow('No application specified');
  });

  it('terminates a process with taskkill', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createProcessOps(runner, 'win32');

    await expect(ops.terminateApp('notepad.exe')).resolves.toBe('Terminated notepad.exe.');
    expect(runner.calls[0]).toEqual({
      kind: 'execFile',
      file: 'taskkill.exe',
      args: ['/IM', 'notepad.exe', '/T'],
      options: { timeoutMs: 10_000 },
    });
  });

  it('adds /F when force terminating', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createProcessOps(runner, 'win32');

    await ops.terminateApp('notepad.exe', true);

    expect(runner.calls[0]?.args).toEqual(['/IM', 'notepad.exe', '/T', '/F']);
  });

  it('refuses to terminate protected processes', async () => {
    const ops = createProcessOps(fakeRunner(), 'win32');
    await expect(ops.terminateApp('node.exe')).rejects.toThrow('Refusing to terminate protected');
    await expect(ops.terminateApp('Explorer.EXE')).rejects.toThrow(
      'Refusing to terminate protected',
    );
  });

  it('rejects malformed process names', async () => {
    const ops = createProcessOps(fakeRunner(), 'win32');
    await expect(ops.terminateApp('rm -rf /')).rejects.toThrow('Invalid process name');
  });

  it('reports taskkill failures', async () => {
    const runner = fakeRunner();
    runner.respond({ code: 1, stderr: 'The process could not be found.' });
    const ops = createProcessOps(runner, 'win32');

    await expect(ops.terminateApp('missing.exe')).rejects.toThrow(
      'Could not terminate "missing.exe"',
    );
  });

  it('parses the process list from PowerShell JSON', async () => {
    const runner = fakeRunner();
    runner.respond({
      stdout: JSON.stringify([
        { Id: 100, ProcessName: 'notepad', MainWindowTitle: 'notes - Notepad' },
        { Id: 200, ProcessName: 'chrome', MainWindowTitle: '' },
      ]),
    });
    const ops = createProcessOps(runner, 'win32');

    const { processes, source } = await ops.listProcesses();

    expect(source).toBe('windows');
    expect(processes).toEqual([
      { id: 100, name: 'notepad', windowTitle: 'notes - Notepad' },
      { id: 200, name: 'chrome', windowTitle: null },
    ]);
  });

  it('handles a single-object and an empty process list', async () => {
    const runner = fakeRunner();
    const ops = createProcessOps(runner, 'win32');

    runner.respond({
      stdout: JSON.stringify({ Id: 5, ProcessName: 'calc', MainWindowTitle: 'Calc' }),
    });
    const single = await ops.listProcesses();
    expect(single.processes).toHaveLength(1);
    expect(single.processes[0]?.name).toBe('calc');

    runner.respond({ stdout: '' });
    const empty = await ops.listProcesses();
    expect(empty.processes).toEqual([]);
  });

  it('does not enumerate processes off Windows', async () => {
    const ops = createProcessOps(fakeRunner(), 'linux');
    const result = await ops.listProcesses();
    expect(result.source).toBe('unsupported');
    expect(result.processes).toEqual([]);
  });

  it('runs a shell command and returns its output', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'hello\nworld' });
    const ops = createProcessOps(runner, 'win32');

    await expect(ops.runShellCommand('echo hello')).resolves.toBe('hello\nworld');
    expect(runner.calls[0]).toMatchObject({ kind: 'shell', command: 'echo hello' });
  });

  it('includes the exit code for failing commands', async () => {
    const runner = fakeRunner();
    runner.respond({ code: 2, stderr: 'boom' });
    const ops = createProcessOps(runner, 'win32');

    await expect(ops.runShellCommand('badcmd')).resolves.toContain('exit code 2');
    await expect(ops.runShellCommand('badcmd')).resolves.toContain('boom');
  });

  it('truncates overly long command output', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'x'.repeat(20_000) });
    const ops = createProcessOps(runner, 'win32');

    const output = await ops.runShellCommand('long');
    expect(output.startsWith('x'.repeat(8_000))).toBe(true);
    expect(output.endsWith('... (output truncated)')).toBe(true);
  });

  it('rejects empty or overly long commands', async () => {
    const ops = createProcessOps(fakeRunner(), 'win32');
    await expect(ops.runShellCommand('   ')).rejects.toThrow('No command');
    await expect(ops.runShellCommand('x'.repeat(2_001))).rejects.toThrow('too long');
  });

  it('runs npm and bun scripts with a working directory', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'ok' });
    const ops = createProcessOps(runner, 'win32');

    await ops.runScript('npm', 'build', { cwd: 'C:\\proj' });
    expect(runner.calls[0]).toMatchObject({
      kind: 'shell',
      command: 'npm run build',
      options: { cwd: 'C:\\proj' },
    });

    await ops.runScript('bun', 'dev');
    expect(runner.calls[1]?.command).toBe('bun run dev');
  });

  it('rejects unsafe runtimes and script names', async () => {
    const ops = createProcessOps(fakeRunner(), 'win32');
    await expect(ops.runScript('yarn' as 'npm', 'build')).rejects.toThrow(
      'Unsupported script runtime',
    );
    await expect(ops.runScript('npm', 'build; rm -rf /')).rejects.toThrow('Invalid script name');
  });
});

describe('system file ops', () => {
  let dir: string;
  let ops: ReturnType<typeof createFileOps>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bro-system-'));
    ops = createFileOps(fakeRunner(), 'win32');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('searches files by name recursively', async () => {
    await mkdir(join(dir, 'sub', 'nested'), { recursive: true });
    await writeFile(join(dir, 'alpha.txt'), 'a');
    await writeFile(join(dir, 'sub', 'beta.md'), 'b');
    await writeFile(join(dir, 'sub', 'nested', 'gama.txt'), 'g');
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'deep-module.txt'), 'hidden');

    const matches = await ops.searchFiles('eta', { root: dir });

    const paths = matches.map((match) => match.path.replaceAll('\\', '/'));
    expect(paths).toContain(`${dir.replaceAll('\\', '/')}/sub/beta.md`);
    expect(paths).not.toContain(`${dir.replaceAll('\\', '/')}/sub/nested/gama.txt`);
    expect(paths).not.toContain(`${dir.replaceAll('\\', '/')}/node_modules/deep-module.txt`);
  });

  it('respects the depth and limit options', async () => {
    await mkdir(join(dir, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
    await writeFile(join(dir, 'target.txt'), 't');
    for (const sub of ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e']) {
      await writeFile(join(dir, sub, 'target.txt'), 't');
    }

    const shallow = await ops.searchFiles('target', { root: dir, depth: 2 });
    expect(shallow).toHaveLength(2);

    const limited = await ops.searchFiles('target', { root: dir, depth: 10, limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('renames and moves files', async () => {
    await writeFile(join(dir, 'old.txt'), 'x');
    await expect(ops.renamePath(join(dir, 'old.txt'), join(dir, 'new.txt'))).resolves.toMatch(
      'new.txt',
    );
    const moved = await ops.renamePath(join(dir, 'new.txt'), join(dir, 'sub', 'final.txt'));
    expect(moved).toMatch('final.txt');
  });

  it('rejects renaming a missing source', async () => {
    await expect(ops.renamePath(join(dir, 'missing.txt'), join(dir, 'x.txt'))).rejects.toThrow(
      'Source not found',
    );
  });

  it('deletes to the Recycle Bin via PowerShell', async () => {
    await writeFile(join(dir, 'trash.txt'), 'x');
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const winOps = createFileOps(runner, 'win32');

    const result = await winOps.deletePath(join(dir, 'trash.txt'));

    expect(result).toContain('Recycle Bin');
    const script = runner.calls[0]?.args?.at(-1) ?? '';
    expect(script).toContain('DeleteFile');
    expect(script).toContain('SendToRecycleBin');
    expect(script).toContain(Buffer.from(join(dir, 'trash.txt'), 'utf8').toString('base64'));
  });

  it('refuses permanent deletes off Windows', async () => {
    const linuxOps = createFileOps(fakeRunner(), 'linux');
    await writeFile(join(dir, 'x.txt'), 'x');
    await expect(linuxOps.deletePath(join(dir, 'x.txt'))).rejects.toThrow(
      'only supported on Windows',
    );
  });

  it('creates folders recursively', async () => {
    await expect(ops.createFolder(join(dir, 'one', 'two'))).resolves.toContain('one');
    const stats = await import('node:fs/promises').then((m) => m.stat(join(dir, 'one', 'two')));
    expect(stats.isDirectory()).toBe(true);
  });
});

describe('system window ops', () => {
  it('parses window listings and returns empty off Windows', async () => {
    const runner = fakeRunner();
    runner.respond({
      stdout: JSON.stringify([{ Id: 1, ProcessName: 'chrome', MainWindowTitle: 'BRO' }]),
    });
    const ops = createWindowOps(runner, 'win32');
    const windows = await ops.listWindows();
    expect(windows).toEqual([{ id: 1, process: 'chrome', title: 'BRO' }]);

    const linux = await createWindowOps(runner, 'linux').listWindows();
    expect(linux).toEqual([]);
  });

  it('builds a focus command from a window id', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'focused' });
    const ops = createWindowOps(runner, 'win32');

    await expect(ops.focusWindow({ id: 42 })).resolves.toContain('id 42');
    const script = runner.calls[0]?.args?.at(-1) ?? '';
    expect(script).toContain('SetForegroundWindow');
    expect(script).toContain('Get-Process -Id 42');
  });

  it('reports a missing window on focus', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'not found' });
    const ops = createWindowOps(runner, 'win32');

    await expect(ops.focusWindow({ title: 'ghost' })).rejects.toThrow('No window found');
  });

  it('requires a target for window actions', async () => {
    const ops = createWindowOps(fakeRunner(), 'win32');
    await expect(ops.focusWindow({})).rejects.toThrow('Specify a window id or title');
    await expect(ops.minimizeWindow({})).rejects.toThrow('Specify a window id or title');
  });

  it('minimizes via ShowWindow', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: 'minimized' });
    const ops = createWindowOps(runner, 'win32');

    await expect(ops.minimizeWindow({ title: 'My App' })).resolves.toContain('My App');
    const script = runner.calls[0]?.args?.at(-1) ?? '';
    expect(script).toContain('ShowWindow');
  });
});

describe('system clipboard ops', () => {
  it('reads the Windows clipboard by decoding base64', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: Buffer.from('hello', 'utf8').toString('base64') });
    const ops = createClipboardOps(runner, 'win32');

    await expect(ops.readOsClipboard()).resolves.toBe('hello');
    expect(runner.calls[0]).toMatchObject({ kind: 'execFile', file: 'powershell.exe' });
  });

  it('reports an empty clipboard', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '__BRO_CLIPBOARD_EMPTY__' });
    const ops = createClipboardOps(runner, 'win32');

    await expect(ops.readOsClipboard()).resolves.toBe('The OS clipboard is empty.');
  });

  it('clamps clipboard reads to the requested size', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: Buffer.from('abcdef', 'utf8').toString('base64') });
    const ops = createClipboardOps(runner, 'win32');

    await expect(ops.readOsClipboard(3)).resolves.toBe('abc… (clipped)');
  });

  it('writes base64-encoded text to the Windows clipboard', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createClipboardOps(runner, 'win32');

    await expect(ops.writeOsClipboard('hi there')).resolves.toContain('8 characters');
    const script = runner.calls[0]?.args?.at(-1) ?? '';
    expect(script).toContain(Buffer.from('hi there', 'utf8').toString('base64'));
    expect(script).toContain('Set-Clipboard');
  });

  it('rejects oversized clipboard writes', async () => {
    const ops = createClipboardOps(fakeRunner(), 'win32');
    await expect(ops.writeOsClipboard('x'.repeat(50_001))).rejects.toThrow('too long');
  });
});

describe('system launcher ops', () => {
  it('opens a browser URL via cmd start', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createLauncherOps(runner, 'win32');

    await expect(ops.openBrowser('https://example.com')).resolves.toContain('example.com');
    expect(runner.calls[0]).toEqual({
      kind: 'execFile',
      file: 'cmd.exe',
      args: ['/c', 'start', '', 'https://example.com'],
      options: { timeoutMs: 10_000 },
    });
  });

  it('rejects non-http URLs', async () => {
    const ops = createLauncherOps(fakeRunner(), 'win32');
    await expect(ops.openBrowser('javascript:alert(1)')).rejects.toThrow('Invalid URL');
    await expect(ops.openBrowser('file:///C:/x')).rejects.toThrow('Invalid URL');
  });

  it('opens VS Code and falls back to the installed path', async () => {
    const runner = fakeRunner();
    runner.respond({ code: 1, stderr: 'not found' });
    runner.respond({ stdout: '' });
    const previous = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    const ops = createLauncherOps(runner, 'win32');

    await expect(ops.openEditor('C:\\proj')).resolves.toContain('VS Code');
    expect(runner.calls[0]).toMatchObject({ kind: 'shell', command: 'code "C:\\proj"' });
    expect(runner.calls[1]).toMatchObject({
      kind: 'execFile',
      file: 'C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      args: ['C:\\proj'],
    });
    if (previous === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = previous;
    }
  });

  it('opens a terminal with Windows Terminal and falls back to cmd', async () => {
    const runner = fakeRunner();
    runner.respond({ stdout: '' });
    const ops = createLauncherOps(runner, 'win32');

    await ops.openTerminal('C:\\proj');
    expect(runner.calls[0]).toMatchObject({
      kind: 'execFile',
      file: 'wt.exe',
      args: ['-d', 'C:\\proj'],
    });

    runner.respond({ code: 1, stderr: 'missing' });
    runner.respond({ stdout: '' });
    await ops.openTerminal('C:\\proj');
    expect(runner.calls[2]).toMatchObject({
      kind: 'execFile',
      file: 'cmd.exe',
      args: ['/c', 'start', 'cmd', '/k', 'cd /d "C:\\proj"'],
    });
  });
});

describe('confirmation store', () => {
  beforeEach(() => {
    clearConfirmations();
  });

  it('creates pending actions and dedupes identical ones', () => {
    const first = createPendingAction({
      userId: 'u1',
      toolName: 'system_delete',
      args: { path: 'C:\\x.txt' },
      summary: 'Delete C:\\x.txt',
    });
    const second = createPendingAction({
      userId: 'u1',
      toolName: 'system_delete',
      args: { path: 'C:\\x.txt' },
      summary: 'Delete C:\\x.txt',
    });

    expect(second.id).toBe(first.id);
    expect(first.status).toBe('pending');
    expect(Date.parse(first.expiresAt) - Date.parse(first.createdAt)).toBe(10 * 60 * 1000);
  });

  it('does not dedupe across users or different args', () => {
    const a = createPendingAction({
      userId: 'u1',
      toolName: 'system_delete',
      args: { path: 'x' },
      summary: 'x',
    });
    const b = createPendingAction({
      userId: 'u2',
      toolName: 'system_delete',
      args: { path: 'x' },
      summary: 'x',
    });
    const c = createPendingAction({
      userId: 'u1',
      toolName: 'system_delete',
      args: { path: 'y' },
      summary: 'y',
    });

    expect(b.id).not.toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it('decides actions once', () => {
    const action = createPendingAction({ userId: 'u1', toolName: 't', args: {}, summary: 's' });

    const approved = decideAction(action.id, 'approve');
    expect(approved?.status).toBe('approved');
    expect(approved?.decidedAt).toBeTruthy();
    expect(decideAction(action.id, 'reject')).toBeNull();

    const rejected = createPendingAction({
      userId: 'u1',
      toolName: 't',
      args: { n: 2 },
      summary: 's',
    });
    expect(decideAction(rejected.id, 'reject')?.status).toBe('rejected');
  });

  it('expires stale pending actions', () => {
    const action = createPendingAction({ userId: 'u1', toolName: 't', args: {}, summary: 's' });

    expireStale(new Date(Date.parse(action.createdAt) + 11 * 60 * 1000));
    expect(action.status).toBe('expired');

    expect(decideAction(action.id, 'approve', new Date('2026-01-02T00:00:00Z'))).toBeNull();
  });

  it('lists actions for a single user newest first', () => {
    createPendingAction({ userId: 'u1', toolName: 'a', args: {}, summary: 'a' });
    createPendingAction({ userId: 'u1', toolName: 'b', args: {}, summary: 'b' });
    createPendingAction({ userId: 'u2', toolName: 'c', args: {}, summary: 'c' });

    const actions = listActionsForUser('u1');
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.toolName)).toEqual(['b', 'a']);
  });
});

describe('describe action', () => {
  it('describes each system action in human terms', () => {
    expect(describeAction('system_delete', { path: 'C:\\x.txt' })).toContain('C:\\x.txt');
    expect(describeAction('system_terminate_app', { name: 'notepad.exe' })).toContain(
      'notepad.exe',
    );
    expect(describeAction('system_run_command', { command: 'dir' })).toContain('dir');
    expect(describeAction('system_run_script', { runtime: 'npm', script: 'build' })).toContain(
      'npm script "build"',
    );
    expect(describeAction('system_rename', { source: 'a', destination: 'b' })).toContain('a');
    expect(describeAction('system_open_browser', { url: 'https://x.io' })).toContain(
      'https://x.io',
    );
    expect(describeAction('mystery_tool', { a: 1 })).toContain('mystery_tool');
  });
});
