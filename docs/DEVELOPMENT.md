# Developer Guide

## Prerequisites

- Node.js 22+ (tested on 24.x), npm 11+
- PostgreSQL 14+ and Redis 7+ (or `docker compose up -d` for local)
- Chromium for browser tools: `npx playwright install chromium`

## Getting started

```bash
npm install
cp .env.example .env          # then fill in secrets
npm run prisma:generate
npm run prisma:migrate        # apply migrations to your local DB
npm run dev                   # API on :3000

# in a second terminal
cd web
npm install
npm run dev                   # web on :3001
```

The API listens on `:3000` (Swagger at `http://localhost:3000/docs`), the web
app on `:3001`. The backend CORS origin must include the frontend origin
(`CORS_ORIGIN`, default `http://localhost:3001`).

## Scripts (root)

| Script | Description |
|---|---|
| `npm run dev` | Watch-mode dev server (`tsx watch`) |
| `npm run build` | Type-check + compile to `dist/` |
| `npm start` | Run the production build (`node dist/server.js`) |
| `npm test` | Full vitest suite |
| `npm run test:unit` | `tests/unit/**` (no external services) |
| `npm run test:integration` | `tests/integration/**` |
| `npm run test:performance` / `test:stress` | Benchmarks/stress |
| `npm run test:ci` | `vitest run --maxWorkers=2` (CI) |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run prisma:generate` / `migrate` / `migrate:deploy` / `studio` | Prisma |

### Web (`web/`)

| Script | Description |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev/build/start |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Frontend vitest suite |
| `npm run format:check` | Prettier check |

## Layout

- `src/routes/*.ts` — one Fastify plugin per route group; registered in
  `src/routes/index.ts`. Route plugins mount under `/api/v1`.
- `src/lib/*.ts` — shared logic (auth, rate-limit, cache, audit, http, oauth).
- `src/tools/*.ts` — assistant tools. Each exports a `Tool` object
  (`name`, `description`, `parameters`, `execute`). Register via
  `src/tools/index.ts` → `registerTool`.
- `src/plugins/` — the plugin loader + manifest validation.
- `src/browser/` — Playwright session pool for `browser_*` tools.
- `web/src/lib/api.ts` — frontend API client (handles refresh-on-401).

## Adding a route

```ts
// src/routes/example.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';

export async function exampleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  const schema = z.object({ name: z.string().min(1).max(100) });

  app.post('/example', async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid body');
    return { greeting: `Hello, ${parsed.data.name}` };
  });
}
```

Then register it in `src/routes/index.ts`. Fastify's `@fastify/swagger`
picks up the route automatically.

## Adding a tool

See the README "Tool framework" section. Keep `execute` deterministic and
**never trust model-provided paths or URLs** — use `resolveSandboxPath` and
`assertPublicHttpUrl`/`fetchWithTimeout` from `src/lib/http.ts`.

## Outbound HTTP rules

Every call to an external service must go through `src/lib/http.ts`:

- `fetchWithTimeout(url, { timeoutMs })` — hard 10s default timeout.
- `fetchJson` / `fetchText` — JSON/text helpers that throw `HttpError`.
- `isPublicHttpUrl` / `assertPublicHttpUrl` — reject private/loopback/link-local
  hosts (SSRF guard). Use them before navigating the browser or fetching URLs
  supplied by the model.

## Testing

- Unit tests in `tests/unit/` (no DB/Redis) run everywhere.
- Route tests (`tests/*.test.ts`) build the Fastify app with mocked Prisma via
  `buildApp` and `supertest`.
- Run a single file: `npx vitest run tests/dashboard.test.ts --maxWorkers=1`.
  On low-memory machines prefer `--maxWorkers=1` to avoid worker OOMs (each
  worker loads Playwright).
- New behavior should ship with tests. Frontend logic tests live in
  `web/tests/` (e.g. `api.test.ts` covers the refresh-on-401 flow).

## Conventions

- TypeScript strict; ES modules with `.js` import suffixes.
- Prettier for formatting, ESLint (typescript-eslint) for linting.
- Zod for all request validation.
- No comments unless they explain *why*; prefer self-documenting code.
- Never log secrets; audit-log sensitive actions with redaction.
