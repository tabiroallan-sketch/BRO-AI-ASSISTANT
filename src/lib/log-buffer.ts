import { Writable } from 'node:stream';

export type LogEntry = {
  level: string;
  time: string;
  msg: string;
  req?: Record<string, unknown> | null;
  res?: Record<string, unknown> | null;
  err?: Record<string, unknown> | null;
};

const MAX_LOGS = 300;
const logs: LogEntry[] = [];

export function pushLog(entry: LogEntry): void {
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

export function getRecentLogs(limit: number): LogEntry[] {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_LOGS);
  return logs.slice(-safeLimit);
}

export function clearLogBuffer(): void {
  logs.length = 0;
}

function levelName(level: unknown): string {
  if (typeof level === 'number') {
    const labels: Record<number, string> = {
      10: 'trace',
      20: 'debug',
      30: 'info',
      40: 'warn',
      50: 'error',
      60: 'fatal',
    };
    return labels[level] ?? String(level);
  }
  if (typeof level === 'string') {
    return level;
  }
  return 'info';
}

export const logBufferStream = new Writable({
  write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    const line = chunk.toString().trim();
    if (line) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        pushLog({
          level: levelName(parsed.level),
          time: typeof parsed.time === 'string' ? parsed.time : new Date().toISOString(),
          msg: typeof parsed.msg === 'string' ? parsed.msg : '',
          req: parsed.req as Record<string, unknown> | null | undefined,
          res: parsed.res as Record<string, unknown> | null | undefined,
          err: parsed.err as Record<string, unknown> | null | undefined,
        });
      } catch {
        // ignore non-JSON chunks
      }
    }
    callback();
  },
});
