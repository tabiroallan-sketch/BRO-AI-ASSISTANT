import { spawnSync } from 'node:child_process';

process.env.TEST_E2E = '1';

const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/e2e'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
