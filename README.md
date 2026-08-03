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
server-sent-event (SSE) stream of `start`, `tool_start`, `tool_result`, `delta`,
`done`, and `error` events. Conversations are titled automatically from the first
message; the last 30 messages are sent as history. Up to 100 of the user's long-term
memories are appended to the system prompt, so the assistant can answer from stored
facts about the user.

## Tool Framework

BRO ships with a modular tool system so the assistant can call tools during a chat
and new capabilities can be added, removed, or replaced in isolation. Tools live in
`src/tools/` and are registered in-memory at boot via `src/tools/index.ts`.

Every tool implements the same interface (`src/tools/types.ts`):

- `name` — unique identifier the model calls (e.g. `get_current_time`)
- `description` — when the tool should be used
- `parameters` — JSON Schema-style description of the arguments
- `execute(args, context)` — runs the tool and returns a string result (`context`
  carries the calling `userId`)

Registering a tool is a single call:

```ts
import { registerTool } from './tools/registry.js';

registerTool({
  name: 'my_tool',
  description: 'Use when ...',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  execute: async (args) => `result for ${args.query}`,
});
```

The registry (`src/tools/registry.ts`) exposes `registerTool`, `unregisterTool`,
`getTool`, `listTools`, and `clearTools`. The chat route reads the registry on every
request, so tools are available to the model immediately.

Built-in tools:

- `get_current_time` — returns the current time as ISO 8601 (UTC) plus a human-readable
  local time in an optional IANA timezone (e.g. `America/New_York`)
- `echo` — echoes the provided `text` back
- `calculate` — safely evaluates math expressions (`+ - * / % ^`, parentheses, unary
  signs, constants `pi`/`e`, and functions like `sqrt`, `abs`, `round`, `floor`, `ceil`,
  `sin`, `cos`, `tan`, `ln`, `log`, `pow`, `min`, `max`) with a hand-written
  tokenizer/parser; `eval` is never used
- `web_search` — searches the web (DuckDuckGo instant answers, Wikipedia fallback) and
  returns snippets with source URLs
- `get_weather` — current weather for a city via Open-Meteo (geocoding + conditions,
  temperature, humidity, precipitation, wind)
- `filesystem` — read/write/list/delete files inside the user's private sandbox
  (`data/sandbox/<userId>/`); paths are validated so they cannot escape the sandbox
- `read_pdf` — extracts text from a PDF stored in the user's sandbox
- `clipboard` — per-user in-memory clipboard (`copy` / `paste` / `clear`) for holding
  short snippets across a conversation
- `notify` — creates an in-app notification for the user (see Notifications below)

When the model requests a tool call, the route streams a `tool_start` event (name +
parsed arguments), executes the tool, streams a `tool_result` event (`ok` + `output`),
and feeds the result back to the model. The model may call tools repeatedly within a
single request (up to 5 rounds); the final reply is streamed as `delta` events and
persisted like any other message. Tool support requires a model that exposes OpenAI-
compatible tool calling; if the provider rejects tools, the request falls back to a
plain chat completion without tools.

The frontend chat page renders tool activity as inline "tool bubbles" while a tool is
running, then marks it done or failed.

## Memories

All memory endpoints require `Authorization: Bearer <accessToken>`. Memories are
user-scoped and keyed per user: posting an existing `key` updates it instead of
creating a duplicate (upsert).

`GET /api/v1/memories` — List the current user's memories (most recently updated first).

`POST /api/v1/memories` — Create or upsert a memory with `key` (max 200 chars), `value`
(max 4000 chars), and optional `category` (max 100 chars). Returns `201` when created
and `200` when an existing key was updated.

`PATCH /api/v1/memories/:id` — Update a memory's `value` and/or `category` (keys are
immutable). Returns `404` for other users' memories.

`DELETE /api/v1/memories/:id` — Delete a memory. Returns `204` on success.

Memories are surfaced in the chat system prompt as `- key: value` lines under a
"stored facts about the user" header.

## Notifications

The assistant can create in-app notifications via the `notify` tool (e.g. "your report
is ready"). Notifications are stored per user in PostgreSQL and appear in the bell menu
in the site navbar, which polls every 30 seconds and shows an unread badge.

`GET /api/v1/notifications` — List the current user's latest 50 notifications (newest
first) plus `unreadCount`.

`PATCH /api/v1/notifications/:id/read` — Mark one notification as read. Returns `204`.

`POST /api/v1/notifications/read-all` — Mark all of the current user's notifications as
read. Returns `204`.

All notification endpoints require `Authorization: Bearer <accessToken>`.

## Voice

Voice is a client-side feature built on the browser-native Web Speech API, so no API
keys or backend routes are required. It works in Chrome and Edge.

- **Voice input (STT)** — A mic button in the chat input starts live speech recognition.
  Interim transcript appears in the textarea as you speak; the final transcript is
  committed on stop. Click the mic again (or the square button) to stop.
- **Voice output (TTS)** — Assistant messages have a speaker button that reads the
  reply aloud. Clicking it again stops playback. Markdown is stripped before speaking
  so formatting is never read out.

The feature degrades gracefully: buttons are hidden when the browser lacks
`SpeechRecognition`/`speechSynthesis` support.

## Frontend

The `web/` directory contains the Next.js frontend (React, Tailwind CSS, shadcn-style
components) with a landing page, login, registration, dashboard, settings, a chat page,
a memories page, and dark mode.

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