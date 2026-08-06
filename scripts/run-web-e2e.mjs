import { spawnSync } from 'node:child_process';

const API_BASE = process.env.BRO_API_URL ?? 'http://localhost:3000';
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3001';

async function check(name, url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (
      response.ok ||
      response.status === 401 ||
      response.status === 302 ||
      response.status === 307
    ) {
      console.log(`[ok] ${name} reachable at ${url}`);
      return true;
    }
  } catch {
    // fall through
  }
  console.error(`[error] ${name} not reachable at ${url}. Start it first.`);
  return false;
}

const backendOk = await check('backend', `${API_BASE}/health`);
const webOk = await check('web', `${WEB_URL}/login`);

if (!backendOk || !webOk) {
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['node_modules/playwright/cli.js', 'test', '--config', 'web-e2e/playwright.config.ts'],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
