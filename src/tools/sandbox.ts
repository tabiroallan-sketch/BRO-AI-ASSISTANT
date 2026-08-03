import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

export function getSandboxRoot(): string {
  const configured = process.env.TOOL_FS_ROOT;
  if (configured) {
    return resolve(configured);
  }
  return resolve(process.cwd(), 'data', 'sandbox');
}

export function getUserSandboxDir(userId: string): string {
  return resolve(getSandboxRoot(), userId);
}

export function ensureSandboxDir(userId: string): string {
  const dir = getUserSandboxDir(userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSandboxPath(userId: string, rawPath: string): string {
  const base = getUserSandboxDir(userId);
  const target = resolve(base, rawPath);
  const relative = target.replace(/\\/g, '/');
  const baseNorm = base.replace(/\\/g, '/');
  if (relative !== baseNorm && !relative.startsWith(`${baseNorm}/`)) {
    throw new Error(`Path "${rawPath}" escapes the sandbox`);
  }
  return target;
}
