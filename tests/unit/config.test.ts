import { describe, expect, it, beforeAll } from 'vitest';

process.env.PORT = '4567';
process.env.DATABASE_POOL_SIZE = '4';
process.env.DATABASE_POOL_TIMEOUT = '9';
process.env.ANALYTICS_CACHE_MS = '12345';
process.env.AUTH_USER_CACHE_MS = '4321';
process.env.CACHE_TTL_MS = '111';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.LOG_LEVEL = 'warn';
process.env.ADMIN_EMAILS = 'admin@example.com, manager@example.com';
process.env.JWT_EXPIRES_IN = '30m';

type ConfigModule = typeof import('../../src/config/index.js');

describe('configuration parsing', () => {
  let config: ConfigModule['config'];

  beforeAll(async () => {
    const loaded = await import('../../src/config/index.js');
    config = loaded.config;
  });

  it('parses numeric configuration values', () => {
    expect(config.port).toBe(4567);
    expect(config.connectionPoolSize).toBe(4);
    expect(config.poolTimeoutSeconds).toBe(9);
    expect(config.analyticsCacheMs).toBe(12345);
    expect(config.authUserCacheMs).toBe(4321);
    expect(config.cacheTtlMs).toBe(111);
  });

  it('applies defaults when variables are unset', () => {
    expect(config.bodyLimit).toBe(1048576);
    expect(config.maxRequestUrlLength).toBe(2048);
    expect(config.rateLimitMax).toBe(100);
    expect(config.auditLogMax).toBe(1000);
  });

  it('parses boolean flags', () => {
    expect(config.rateLimitEnabled).toBe(false);
    expect(config.browserEnabled).toBe(false);
  });

  it('parses CSV lists', () => {
    expect(config.adminEmails).toEqual(['admin@example.com', 'manager@example.com']);
  });

  it('reads string configuration', () => {
    expect(config.logLevel).toBe('warn');
    expect(config.jwtExpiresIn).toBe('30m');
  });
});
