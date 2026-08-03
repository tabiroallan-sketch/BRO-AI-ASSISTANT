import Redis from 'ioredis';
import { config } from '../config/index.js';

function createRedisClient(): Redis | null {
  if (!config.redisUrl) {
    return null;
  }
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  client.on('error', () => {
    // Connection errors are surfaced through health checks. An unhandled
    // 'error' event would crash the process.
  });
  return client;
}

export const redis = createRedisClient();
