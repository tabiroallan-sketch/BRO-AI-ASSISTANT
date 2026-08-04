import 'dotenv/config';
import path from 'node:path';
import { getSecret } from '../lib/secrets.js';

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  jwtSecret: getSecret('JWT_SECRET'),
  jwtRefreshSecret: getSecret('JWT_REFRESH_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  openaiApiKey: getSecret('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? '',
  elevenLabsApiKey: getSecret('ELEVENLABS_API_KEY'),
  googleClientId: getSecret('GOOGLE_CLIENT_ID'),
  googleClientSecret: getSecret('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',
  n8nBaseUrl: process.env.N8N_BASE_URL ?? '',
  n8nApiKey: getSecret('N8N_API_KEY'),
  browserEnabled: process.env.BROWSER_ENABLED !== 'false',
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserNoSandbox: process.env.BROWSER_NO_SANDBOX === 'true',
  browserTimeout: parseInt(process.env.BROWSER_TIMEOUT ?? '30000', 10),
  browserIdleTimeoutMs: parseInt(process.env.BROWSER_IDLE_TIMEOUT_MS ?? '600000', 10),
  integrationRedirectBase:
    process.env.INTEGRATION_REDIRECT_BASE ?? 'http://localhost:3000/api/v1/integrations',
  integrationEncryptionKey: getSecret('ENCRYPTION_KEY') || getSecret('INTEGRATION_ENCRYPTION_KEY'),
  githubClientId: getSecret('GITHUB_CLIENT_ID'),
  githubClientSecret: getSecret('GITHUB_CLIENT_SECRET'),
  slackClientId: getSecret('SLACK_CLIENT_ID'),
  slackClientSecret: getSecret('SLACK_CLIENT_SECRET'),
  discordWebhookEnabled: process.env.DISCORD_WEBHOOK_ENABLED ?? 'true',
  notionClientId: getSecret('NOTION_CLIENT_ID'),
  notionClientSecret: getSecret('NOTION_CLIENT_SECRET'),
  whatsappToken: getSecret('WHATSAPP_TOKEN'),
  whatsappPhoneNumberId: getSecret('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappApiUrl: process.env.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v18.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  appVersion: '0.1.0',
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  auditLogMax: parseInt(process.env.AUDIT_LOG_MAX ?? '1000', 10),
  bodyLimit: parseInt(process.env.BODY_LIMIT_BYTES ?? '1048576', 10),
  maxRequestUrlLength: parseInt(process.env.MAX_REQUEST_URL_LENGTH ?? '2048', 10),
  adminEmails: csv(process.env.ADMIN_EMAILS),
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS ?? '60000', 10),
  analyticsCacheMs: parseInt(process.env.ANALYTICS_CACHE_MS ?? '60000', 10),
  authUserCacheMs: parseInt(process.env.AUTH_USER_CACHE_MS ?? '0', 10),
  connectionPoolSize: parseInt(process.env.DATABASE_POOL_SIZE ?? '10', 10),
  poolTimeoutSeconds: parseInt(process.env.DATABASE_POOL_TIMEOUT ?? '5', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as
    'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent',
  pluginsDir: process.env.PLUGINS_DIR ?? path.join(process.cwd(), 'plugins'),
} as const;
