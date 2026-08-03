import { PrismaClient } from '../generated/index.js';
import { config } from '../config/index.js';

function createPrismaClient(): PrismaClient | null {
  if (!config.databaseUrl) {
    return null;
  }
  return new PrismaClient({
    datasources: {
      db: { url: config.databaseUrl },
    },
    log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = createPrismaClient();

export { Prisma } from '../generated/index.js';
