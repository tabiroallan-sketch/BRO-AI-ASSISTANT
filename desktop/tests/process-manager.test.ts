import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createManagedProcess } from '../src/main/servers/process-manager.js';

type Stream = {
  on: (event: string, cb: (chunk: Buffer) => void) => void;
  emit: (event: string, chunk?: Buffer) => void;
};

function makeStream(): Stream {
  const emitter = new EventEmitter();
  return {
    on: (event, cb) => emitter.on(event, cb),
    emit: (event, chunk) => emitter.emit(event, chunk),
  };
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed: boolean = false;
  readonly stdout: Stream;
  readonly stderr: Stream;

  constructor() {
    super();
    this.stdout = makeStream();
    this.stderr = makeStream();
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit('exit', 0, signal ?? null);
    return true;
  }

  crash(code = 1): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

function makeSpawnFn() {
  let spawnCount = 0;
  const children: FakeChild[] = [];
  const spawnFn = (): FakeChild => {
    const child = new FakeChild();
    spawnCount += 1;
    children.push(child);
    return child;
  };
  return {
    spawnCount: () => spawnCount,
    children,
    spawnFn: spawnFn as unknown as typeof import('node:child_process').spawn,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createManagedProcess', () => {
  it('becomes running once the health probe succeeds', async () => {
    const { spawnFn } = makeSpawnFn();
    const states: string[] = [];
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => true,
      spawnFn,
      onLog: () => undefined,
    });
    service.onStateChange((state) => states.push(state));
    await service.start();
    expect(service.getState()).toBe('running');
    expect(states).toEqual(['starting', 'running']);
  });

  it('reports error when the process never becomes ready', async () => {
    const { spawnFn } = makeSpawnFn();
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => false,
      startTimeoutMs: 200,
      healthPollMs: 20,
      spawnFn,
    });
    await service.start();
    expect(service.getState()).toBe('error');
  });

  it('restarts after an unexpected exit', async () => {
    const { spawnFn, children } = makeSpawnFn();
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => true,
      backoffMs: 5,
      spawnFn,
    });
    await service.start();
    expect(children.length).toBe(1);
    children[0]!.crash();
    await sleep(60);
    expect(service.getState()).toBe('running');
    expect(children.length).toBe(2);
  });

  it('trips the crash-loop breaker after repeated exits', async () => {
    const { spawnFn, children } = makeSpawnFn();
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => true,
      backoffMs: 2,
      maxRestarts: 2,
      spawnFn,
    });
    await service.start();
    children[0]!.crash();
    await sleep(40);
    expect(children.length).toBe(2);
    children[1]!.crash();
    await sleep(40);
    expect(children.length).toBe(3);
    children[2]!.crash();
    await sleep(40);
    expect(service.getState()).toBe('error');
    expect(children.length).toBe(3);
  });

  it('stop kills the child and marks the process stopped', async () => {
    const { spawnFn, children } = makeSpawnFn();
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => true,
      spawnFn,
    });
    await service.start();
    await service.stop();
    expect(service.getState()).toBe('stopped');
    expect(children[0]!.killed).toBe(true);
  });

  it('restart stops then starts again', async () => {
    const { spawnFn, children } = makeSpawnFn();
    const service = createManagedProcess({
      label: 'api',
      command: 'node',
      args: [],
      cwd: process.cwd(),
      env: {},
      health: async () => true,
      spawnFn,
    });
    await service.start();
    await service.restart();
    expect(service.getState()).toBe('running');
    expect(children.length).toBe(2);
  });
});
