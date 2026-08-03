# BRO

BRO is a production-quality AI assistant platform built with Node.js, TypeScript, Fastify, Prisma, PostgreSQL, and Redis.

## Architecture

BRO follows a modular, layered architecture:

- **API Layer** — Fastify with modular routing, schema validation via Zod, and OpenAPI documentation
- **Service Layer** — Business logic separated from transport
- **Data Layer** — Prisma ORM with PostgreSQL, Redis for caching and sessions
- **AI Layer** — OpenAI SDK and LangGraph for AI capabilities
- **Plugin System** — Extensible tool and plugin architecture

## Project Structure

```
bro/
├── src/
│   ├── config/          # Configuration management
│   ├── generated/       # Prisma client output
│   ├── lib/             # Shared utilities
│   ├── routes/          # Modular route handlers
│   ├── middleware/       # Shared middleware
│   ├── app.ts           # Fastify app factory
│   └── server.ts        # Server bootstrap
├── prisma/              # Database schema & migrations
├── tests/               # Test files
├── docker/              # Docker build context
├── .husky/              # Git hooks
├── .vscode/             # VS Code settings
├── docker-compose.yml   # Full stack orchestration
├── Dockerfile           # Production container
├── .env.example         # Environment variable template
└── README.md
```

## Prerequisites

- Node.js 22+
- npm 11+
- Docker Desktop (for PostgreSQL and Redis)

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your values
3. Install dependencies:
   ```bash
   npm install
   ```
4. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
5. Run database migrations:
   ```bash
   npm run prisma:migrate
   ```
6. Start the development server:
   ```bash
   npm run dev
   ```
7. Start the full stack with Docker:
   ```bash
   docker-compose up -d
   ```

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production build |
| `npm run test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint the codebase |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without modifying |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations in development |
| `npm run prisma:migrate:deploy` | Apply pending migrations (deploy/CI) |
| `npm run prisma:studio` | Open Prisma Studio GUI |

## API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:3000/docs
- **OpenJSON spec**: http://localhost:3000/docs/json

## Authentication

All API routes are versioned under `/api/v1`.

`POST /api/v1/auth/register` — Create an account with `email`, `password` (min 8 chars), and
optional `displayName`. Returns short-lived access and refresh tokens.

`POST /api/v1/auth/login` — Exchange `email` + `password` for a token pair.

`POST /api/v1/auth/refresh` — Rotate a refresh token; returns a new token pair and revokes
the presented token.

`POST /api/v1/auth/logout` — Revoke a refresh token.

`GET /api/v1/auth/me` — Returns the current user (requires `Authorization: Bearer <accessToken>`).

`GET /api/v1/auth/providers` — Lists the enabled authentication providers (`email`, and
`google` when configured).

`GET /api/v1/auth/google` — Starts the Google OAuth flow (redirects to Google).

`GET /api/v1/auth/google/callback` — Google OAuth callback; redirects to the frontend with
access/refresh tokens in the URL fragment.

Access tokens are signed JWTs (HS256) and expire per `JWT_EXPIRES_IN`. Refresh tokens
are opaque, stored hashed in the `sessions` table, and expire per `JWT_REFRESH_EXPIRES_IN`.

## Chat & Conversations

All chat endpoints require `Authorization: Bearer <accessToken>`. The streaming chat
endpoint uses OpenAI-compatible APIs (configure `OPENAI_API_KEY`, `OPENAI_MODEL`, and
optionally `OPENAI_BASE_URL`). It returns `503 AI is not configured` when no API key
is set.

`POST /api/v1/conversations` — Create a conversation with an optional `title`.

`GET /api/v1/conversations` — List the current user's conversations (newest first).

`GET /api/v1/conversations/:id` — Fetch a conversation with its messages.

`PATCH /api/v1/conversations/:id` — Rename a conversation.

`DELETE /api/v1/conversations/:id` — Delete a conversation.

`POST /api/v1/chat` — Send a `message` (and optional `conversationId`) and receive a
server-sent-event (SSE) stream of `start`, `delta`, `done`, and `error` events.
Conversations are titled automatically from the first message; the last 30 messages
are sent as history.

## Frontend

The `web/` directory contains the Next.js frontend (React, Tailwind CSS, shadcn-style
components) with a landing page, login, registration, dashboard, settings, a chat page,
and dark mode.

```bash
cd web
npm install
npm run dev   # http://localhost:3001
```

| Script | Description |
|---|---|
| `npm run dev` | Start the dev server on port 3001 |
| `npm run build` | Production build |
| `npm run lint` | Lint the frontend |
| `npm run typecheck` | Type-check the frontend |
| `npm test` | Run frontend tests (vitest) |
| `npm run format:check` | Check formatting with Prettier |

The frontend talks to the API at `NEXT_PUBLIC_API_URL` (defaults to
`http://localhost:3000/api/v1`). The backend CORS origin must include the frontend
origin (`http://localhost:3001`).

## Health Check

`GET /health` — Returns the status of the application and its dependencies (database, Redis).

Each check reports `ok`, `error`, or `disabled` (a check is `disabled` when the
corresponding service is not configured). The endpoint returns `200` when every
enabled check passes and `503` when any enabled check fails.

```json
{
  "status": "ok",
  "checks": {
    "application": { "status": "ok" },
    "database": { "status": "ok", "latencyMs": 4 },
    "redis": { "status": "ok", "latencyMs": 2 }
  },
  "uptime": 12.3,
  "timestamp": "2026-08-03T00:00:00.000Z"
}
```

## License

MIT