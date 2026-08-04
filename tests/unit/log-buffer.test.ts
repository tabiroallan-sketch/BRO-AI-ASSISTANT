import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearLogBuffer,
  getRecentLogs,
  logBufferStream,
  pushLog,
  type LogEntry,
} from '../../src/lib/log-buffer.js';

const entry = (msg: string): LogEntry => ({
  level: 'info',
  time: '2026-08-04T00:00:00.000Z',
  msg,
});

describe('log buffer', () => {
  beforeEach(() => {
    clearLogBuffer();
  });

  it('returns pushed entries in insertion order', () => {
    pushLog(entry('first'));
    pushLog(entry('second'));
    const logs = getRecentLogs(10);
    expect(logs.map((log) => log.msg)).toEqual(['first', 'second']);
  });

  it('caps the buffer at 300 entries', () => {
    for (let index = 0; index < 350; index += 1) {
      pushLog(entry(`entry-${index}`));
    }
    const logs = getRecentLogs(400);
    expect(logs.length).toBe(300);
    expect(logs[0]?.msg).toBe('entry-50');
    expect(logs[299]?.msg).toBe('entry-349');
  });

  it('returns the newest entries for a given limit', () => {
    for (let index = 0; index < 10; index += 1) {
      pushLog(entry(`entry-${index}`));
    }
    expect(getRecentLogs(3).map((log) => log.msg)).toEqual(['entry-7', 'entry-8', 'entry-9']);
  });

  it('clamps the requested limit to a safe range', () => {
    pushLog(entry('only'));
    expect(getRecentLogs(0).length).toBe(1);
    expect(getRecentLogs(-5).length).toBe(1);
    expect(getRecentLogs(1000).length).toBe(1);
  });

  it('clears all entries', () => {
    pushLog(entry('temporary'));
    clearLogBuffer();
    expect(getRecentLogs(10)).toEqual([]);
  });

  it('parses JSON log lines and maps numeric levels', async () => {
    const written = new Promise<void>((resolve) => {
      logBufferStream.once('finish', resolve);
    });
    logBufferStream.write(
      JSON.stringify({ level: 50, time: '2026-08-04T01:00:00.000Z', msg: 'boom', req: {} }) + '\n',
    );
    logBufferStream.write('not json at all\n');
    logBufferStream.end();
    await written;
    const logs = getRecentLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error', msg: 'boom' });
  });
});
