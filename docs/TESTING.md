# Testing Guide

This guide describes the five test layers in the BRO repo, how to run each,
and the expectations for performance and stress suites.

## Test layers

| Layer        | Location             | Command                    | Needs real services? |
|--------------|----------------------|----------------------------|----------------------|
| Unit         | `tests/unit/`        | `npm run test:unit`        | No                   |
| Integration  | `tests/integration/` | `npm run test:integration` | No                   |
| E2E          | `tests/e2e/`         | `npm run test:e2e`         | Yes (Postgres)       |
| Performance  | `tests/performance/` | `npm run test:performance` | No                   |
| Stress       | `tests/stress/`      | `npm run test:stress`      | No                   |

The default `npm run test` (Vitest) picks up everything under `tests/`. E2E
suites are skipped unless `TEST_E2E=1` is set.

### Unit (`tests/unit`)

Pure logic tests against individual modules: cache, JWT, password hashing,
encryption, output validation, secrets, log buffering, rate limiting, the
calculator tool, tool registry, plugin manifest, audit logging, config, and
current-time. No network or database access.

### Integration (`tests/integration`)

Boots the Fastify app in-process with an in-memory Prisma mock
(`tests/helpers/mock-db.ts`) and disabled Redis. `app.test.ts` covers health,
Swagger, CORS, helmet, error shapes and auth; `journey.test.ts` drives a full
user flow: register → chat SSE → memory → analytics → refresh → logout.

### E2E (`tests/e2e`)

End-to-end HTTP flow against a real running stack. Gated behind `TEST_E2E=1`
and requires a real `DATABASE_URL`. Prisma data created during the run is
cleaned up afterward.

```powershell
npm run test:e2e
```

The `test:e2e` script (`scripts/run-e2e.mjs`) sets `TEST_E2E=1` and runs Vitest
against `tests/e2e` only. If a real database is not reachable the suite will
fail; when not invoked via the script (e.g. a bare `vitest run`) the files
report as skipped.

### Performance (`tests/performance`)

Timing-bound assertions (e.g. cache hits under 1 ms, 300 health requests under
the budget). Each suite runs with `{ retry: 2 }` to absorb scheduler jitter on
loaded machines. Use a single worker when running them locally:

```powershell
npx vitest run tests/performance --maxWorkers=1
```

### Stress (`tests/stress`)

Concurrency suites: 40 parallel SSE chat streams, 30 parallel registrations /
logins, cache churn under concurrency, and 200 simultaneous health requests.
The health/auth stress suites disable the rate limiter
(`RATE_LIMIT_ENABLED=false`) so the test exercises throughput rather than the
100/min per-IP limit.

## In-memory database mock

`tests/helpers/mock-db.ts` exports a factory (`createMockDb`) plus a singleton
`getMockDb()` and `resetMockDb()`. Test files mock Prisma through:

```ts
vi.mock('../src/lib/prisma.js', async () => {
  const { getMockDb } = await import('../helpers/mock-db.js');
  return { prisma: getMockDb().mockPrisma };
});
```

`getMockDb()` returns a single shared instance per test file, so cross-module
state (sessions, conversations, memories) stays consistent within a file. Call
`resetMockDb()` in `beforeEach` to isolate tests.

Models backed by the mock: `user`, `session`, `conversation`, `message`,
`memory`, `notification`, `integration`.

## CI

The CI workflow runs `npm run test:ci`, which executes `vitest run
--maxWorkers=2`. The worker cap avoids machine OOMs on the GitHub Actions
runner. Long-lived runs on dev machines should use the same command:

```powershell
npm run test:ci
```

## Gates before commit

```powershell
npx eslint .
npx prettier --check .
npx tsc -p tsconfig.build.json --noEmit
npm run test:ci
npm run build
```
