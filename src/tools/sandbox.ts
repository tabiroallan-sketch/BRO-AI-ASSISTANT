import { isAbsolute, relative, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';

export function getSandboxRoot(): string {
  const configured = process.env.TOOL_FS_ROOT;
  if (configured) {
    return resolve(configured);
  }
  return resolve(process.cwd(), 'data', 'sandbox');
}

function safeComponent(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function getUserSandboxDir(userId: string): string {
  return resolve(getSandboxRoot(), safeComponent(userId));
}

export function ensureSandboxDir(userId: string): string {
  const dir = getUserSandboxDir(userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSandboxPath(userId: string, rawPath: string): string {
  const base = getUserSandboxDir(userId);
  const target = resolve(base, rawPath);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path "${rawPath}" escapes the sandbox`);
  }
  return target;
}
