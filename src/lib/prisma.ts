import { PrismaClient } from '../generated/index.js';
import { config } from '../config/index.js';

function withPoolOptions(url: string): string {
  try {
    const parsed = new URL(url);
    if (config.connectionPoolSize > 1) {
      parsed.searchParams.set('connection_limit', String(config.connectionPoolSize));
    }
    parsed.searchParams.set('pool_timeout', String(config.poolTimeoutSeconds));
    return parsed.toString();
  } catch {
    return url;
  }
}

function createPrismaClient(): PrismaClient | null {
  if (!config.databaseUrl) {
    return null;
  }
  return new PrismaClient({
    datasources: {
      db: { url: withPoolOptions(config.databaseUrl) },
    },
    log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = createPrismaClient();

export { Prisma } from '../generated/index.js';
