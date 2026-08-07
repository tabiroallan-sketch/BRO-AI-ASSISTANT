import { Prisma, prisma } from '../lib/prisma.js';
import { fetchJson } from '../lib/http.js';
import { getValidAccessToken } from '../integrations/store.js';
import { createDedupeStore } from './dedupe.js';
import { createDefaultProbeDeps } from './probes.js';
import { createScheduler, type Scheduler, type SchedulerDependencies } from './scheduler.js';
import type { ProactiveSweepResult, ProactiveStatus } from './types.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let intervalMs = 0;
let lastSweep: ProactiveSweepResult | null = null;
let lastSweepError: string | null = null;

function buildScheduler(): Scheduler {
  const probeDeps = createDefaultProbeDeps();
  const deps: SchedulerDependencies = {
    listUsers: async () => {
      if (!prisma || typeof prisma.user?.findMany !== 'function') {
        return [];
      }
      const users = await prisma.user.findMany({ select: { id: true, settings: true } });
      return users.map((user) => ({ id: user.id, settings: user.settings }));
    },
    getToken: (userId, providerId) => getValidAccessToken(userId, providerId),
    createNotification: async ({ userId, title, body, kind, priority, metadata }) => {
      if (!prisma || typeof prisma.notification?.create !== 'function') {
        return;
      }
      await prisma.notification.create({
        data: {
          userId,
          title,
          body,
          kind,
          priority,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    },
    dedupe: createDedupeStore(),
    commandRunner: probeDeps.commandRunner,
    systemProbe: probeDeps.systemProbe,
    portProbe: probeDeps.portProbe,
    httpProbe: probeDeps.httpProbe,
    fetch: (url, init) => fetchJson(url, init),
    now: () => new Date(),
  };
  return createScheduler(deps);
}

async function sweepOnce(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    lastSweep = await buildScheduler().runSweep();
    lastSweepError = null;
  } catch (error) {
    lastSweepError = error instanceof Error ? error.message : String(error);
  } finally {
    running = false;
  }
}

export function startProactiveMonitor(configuredIntervalMs: number): void {
  stopProactiveMonitor();
  intervalMs = configuredIntervalMs;
  void sweepOnce();
  timer = setInterval(() => void sweepOnce(), configuredIntervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export function stopProactiveMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function runProactiveSweep(): Promise<ProactiveSweepResult | null> {
  return sweepOnce().then(() => lastSweep);
}

export function getProactiveStatus(): ProactiveStatus {
  return {
    running,
    intervalMs,
    lastSweep,
    lastSweepError,
  };
}
