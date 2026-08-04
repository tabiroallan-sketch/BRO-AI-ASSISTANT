import { performance } from 'node:perf_hooks';
import { prisma } from './prisma.js';
import { redis } from './redis.js';

export type CheckStatus = 'ok' | 'error' | 'disabled';

export type CheckResult = {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
};

export type HealthReport = {
  status: 'ok' | 'degraded';
  checks: {
    application: CheckResult;
    database: CheckResult;
    redis: CheckResult;
  };
  uptime: number;
  timestamp: string;
};

const HEALTH_CHECK_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Health check timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function latencySince(start: number): number {
  return Math.round(performance.now() - start);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function checkApplication(): CheckResult {
  return { status: 'ok' };
}

export async function checkDatabase(): Promise<CheckResult> {
  if (!prisma) {
    return { status: 'disabled' };
  }
  const start = performance.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS);
    return { status: 'ok', latencyMs: latencySince(start) };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: latencySince(start),
      error: messageOf(error),
    };
  }
}

export async function checkRedis(): Promise<CheckResult> {
  if (!redis) {
    return { status: 'disabled' };
  }
  const start = performance.now();
  try {
    if (redis.status !== 'ready') {
      await withTimeout(redis.connect(), HEALTH_CHECK_TIMEOUT_MS);
    }
    const pong = await withTimeout(redis.ping(), HEALTH_CHECK_TIMEOUT_MS);
    return {
      status: pong === 'PONG' ? 'ok' : 'error',
      latencyMs: latencySince(start),
    };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: latencySince(start),
      error: messageOf(error),
    };
  }
}

export async function getHealthReport(): Promise<HealthReport> {
  const [database, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);
  const checks = {
    application: checkApplication(),
    database,
    redis: redisCheck,
  };
  const allOk = Object.values(checks).every(
    (check) => check.status === 'ok' || check.status === 'disabled',
  );
  return {
    status: allOk ? 'ok' : 'degraded',
    checks,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}
