import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e'],
    pool: 'forks',
    maxWorkers: 3,
    minWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 20000,
    globals: true,
  },
});
