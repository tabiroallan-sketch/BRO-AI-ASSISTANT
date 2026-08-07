import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { fetchWithTimeout } from '../lib/http.js';
import { createRunner } from '../system/exec.js';
import type { Runner } from '../system/types.js';

export interface DiskInfo {
  mount: string;
  freeGb: number;
  sizeGb: number;
}

export interface SystemSample {
  cpuPercent: number;
  disks: DiskInfo[];
}

export type SystemProbe = () => Promise<SystemSample>;

export type PortProbe = (port: number, host?: string, timeoutMs?: number) => Promise<boolean>;

export type HttpProbe = (
  url: string,
  timeoutMs?: number,
) => Promise<{ ok: boolean; status: number }>;

/** Parses the output of `df -P` (1024-byte blocks) into disk info. */
export function parseDfOutput(output: string): DiskInfo[] {
  const disks: DiskInfo[] = [];
  const lines = output
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) {
      continue;
    }
    const blocks = Number(parts[1]);
    const available = Number(parts[3]);
    if (!Number.isFinite(blocks) || !Number.isFinite(available)) {
      continue;
    }
    disks.push({
      mount: parts.slice(5).join(' '),
      freeGb: Math.round((available / 1048576) * 100) / 100,
      sizeGb: Math.round((blocks / 1048576) * 100) / 100,
    });
  }
  return disks;
}

/** Parses the JSON emitted by the Windows disk PowerShell probe. */
export function parseWindowsDisks(output: string): DiskInfo[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((entry): entry is Record<string, unknown> => {
        return typeof entry === 'object' && entry !== null && !Array.isArray(entry);
      })
      .map((entry) => ({
        mount: String(entry.DeviceID ?? ''),
        freeGb: typeof entry.FreeGB === 'number' ? entry.FreeGB : 0,
        sizeGb: typeof entry.SizeGB === 'number' ? entry.SizeGB : 0,
      }));
  } catch {
    return [];
  }
}

/** CPU percentage derived from a Unix load average over the CPU count. */
export function cpuFromLoad(loadAvg1: number, cpuCount: number): number {
  if (!Number.isFinite(loadAvg1) || loadAvg1 < 0 || cpuCount < 1) {
    return 0;
  }
  return Math.min(Math.round((loadAvg1 / cpuCount) * 100), 100);
}

const WINDOWS_CPU_COMMAND =
  'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average"';
const WINDOWS_DISK_COMMAND =
  "powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,@{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,2)}},@{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}} | ConvertTo-Json -Compress\"";

function parseWindowsCpu(output: string): number {
  const parsed = Number.parseFloat(output.trim());
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0;
}

function readDf(): DiskInfo[] {
  try {
    const output = execFileSync('df', ['-P'], { encoding: 'utf8', timeout: 10_000 });
    return parseDfOutput(output);
  } catch {
    return [];
  }
}

/**
 * Creates a system probe. On Windows it shells out to PowerShell (CIM); on
 * other platforms it uses `df -P` and `os.loadavg()`.
 */
export function createSystemProbe(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): SystemProbe {
  return async () => {
    if (platform === 'win32') {
      const [cpuResult, diskResult] = await Promise.all([
        runner.shell(WINDOWS_CPU_COMMAND),
        runner.shell(WINDOWS_DISK_COMMAND),
      ]);
      return {
        cpuPercent: parseWindowsCpu(cpuResult.stdout),
        disks: parseWindowsDisks(diskResult.stdout),
      };
    }
    return {
      cpuPercent: cpuFromLoad(os.loadavg()[0] ?? 0, os.cpus().length),
      disks: readDf(),
    };
  };
}

/** Probes whether a TCP port on the given host is accepting connections. */
export function createPortProbe(): PortProbe {
  return (port, host = '127.0.0.1', timeoutMs = 3000) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      let settled = false;
      const timer = setTimeout(() => done(false), timeoutMs);
      const done = (ok: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
}

/** Probes an HTTP endpoint; a network failure resolves to { ok: false, status: 0 }. */
export function createHttpProbe(): HttpProbe {
  return async (url, timeoutMs = 5000) => {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        timeoutMs,
        redirect: 'follow',
      });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: 0 };
    }
  };
}

export function createDefaultProbeDeps(platform: NodeJS.Platform = process.platform): {
  commandRunner: Runner;
  systemProbe: SystemProbe;
  portProbe: PortProbe;
  httpProbe: HttpProbe;
} {
  const commandRunner = createRunner({ defaultTimeoutMs: 60_000 });
  return {
    commandRunner,
    systemProbe: createSystemProbe(commandRunner, platform),
    portProbe: createPortProbe(),
    httpProbe: createHttpProbe(),
  };
}
