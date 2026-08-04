# Architecture

BRO is a self-hosted AI assistant platform: a TypeScript/Fastify API, a Next.js
frontend, PostgreSQL, and Redis. The assistant streams answers in real time,
calls tools (filesystem, web, browser, n8n, third-party integrations) during a
conversation, and can be extended with drop-in plugins.

## High-level view

```
                ┌─────────────┐
  browser ─────►│ reverse     │   Caddy / Nginx (TLS)
                │  proxy      │
                └──────┬──────┘
        :3001          │        :3000
  ┌──────────────┐   ┌─────────────┐
  │ bro-web      │   │ bro-api     │──► OpenAI-compatible endpoint
  │ (Next.js)    │◄──┤ (Fastify)   │──► n8n instance
  └──────────────┘   │             │──► browser (headless Chromium)
                     └─────┬───────┘
              ┌────────────┴───────────┐
              │ PostgreSQL             │  Redis (optional)
              │  prisma schema +      │  sessions, rate limiting,
              │  migrations           │  pub/sub for browser jobs
              └────────────────────────┘
```

- The **API** (`src/`) is a single Fastify process. All routes are under
  `/api/v1` and validated with Zod. OpenAPI is generated at runtime and served
  at `/docs`.
- The **web app** (`web/`) is a Next.js (React) SPA. It talks to the API from
  the browser, so `NEXT_PUBLIC_API_URL` must be a browser-reachable URL.
- **PostgreSQL** is the system of record (users, sessions, conversations,
  messages, memories, notifications, integrations).
- **Redis** is optional: when `REDIS_URL` is set it is used for refresh-token
  sessions, rate limiting, and the browser job queue; otherwise in-memory
  fallbacks are used (process-local).

## Process layout (`src/`)

| Directory | Responsibility |
|---|---|
| `config/` | Environment parsing into a typed `config` object |
| `server.ts` | Bootstrap: build app, listen, graceful shutdown |
| `app.ts` | Fastify app factory: plugins, hooks, route registration |
| `routes/` | Fastify route modules (`auth`, `chat`, `conversations`, …) |
| `lib/` | Shared utilities (auth, rate-limit, cache, audit, http, oauth, …) |
| `tools/` | Built-in assistant tools + the tool registry |
| `plugins/` | Plugin loader, manifest validation, plugin registry |
| `browser/` | Playwright session management for the `browser_*` tools |
| `integrations/` | Third-party providers (Google, GitHub, Slack, Notion, n8n, …) |
| `generated/` | Prisma client output (build artifact) |

## Request lifecycle

1. Incoming request → global hooks (rate limiting, security headers).
2. Route pre-handlers authenticate (`requireAuth`) and authorize
   (`requireRole('ADMIN')`) where needed.
3. Zod schema validation rejects malformed bodies with `400`.
4. Handlers run business logic against Prisma/Redis and return JSON.
5. Security-relevant actions write to the in-memory audit log.

## Streaming chat

`POST /api/v1/chat` is the hot path:

```
client ─ POST /chat ─► get/create conversation, persist user message
       ◄── HTTP 200 + hijacked socket ──
       ◄─ data: {"type":"start","conversationId":…}
       ◄─ data: {"type":"delta","content":…}      (as tokens arrive)
       ◄─ data: {"type":"tool_start","name":…}    (model requests a tool)
       ◄─ data: {"type":"tool_result","ok":…}     (tool output fed back)
       ◄─ data: {"type":"done","message":…}       (assistant message saved)
```

- History is the last 30 messages; up to 100 long-term memories are added to
  the system prompt.
- Tool rounds are bounded (`TOOL_CALL_LIMIT = 5`); providers that reject the
  `tools` array fall back to a plain completion.
- Output is sanitized (control chars stripped, secrets redacted) before it is
  streamed or persisted.
- If the client disconnects, the model call is aborted and partial text is
  saved so the conversation is never lost.
- Reverse proxies **must not buffer** the SSE response (`X-Accel-Buffering:
  no` is set).

## Security boundaries

- **Authentication**: JWT access tokens (HS256, short-lived) + opaque refresh
  tokens stored hashed in Postgres (or Redis). Passwords are bcrypt-hashed.
- **RBAC**: `USER` / `ADMIN` roles; emails in `ADMIN_EMAILS` are promoted on
  login. Admin/automation/log endpoints are guarded by `requireRole('ADMIN')`.
- **SSRF guard** (`src/lib/http.ts`): every outbound HTTP call from tools and
  integrations goes through `fetchWithTimeout` after `isPublicHttpUrl`
  validation. Private/loopback/link-local ranges (IPv4 and IPv6) are blocked
  and DNS is re-checked; `localhost` is rejected.
- **Sandbox** (`src/tools/sandbox.ts`): file tools operate inside
  `data/sandbox/<userId>/`; paths are resolved relative to the sandbox root and
  escapes are rejected. User ids are sanitized to `[A-Za-z0-9._-]`.
- **Encryption at rest**: integration tokens are AES-256-GCM encrypted
  (`enc:v1:…`). The key comes from `ENCRYPTION_KEY` → `INTEGRATION_ENCRYPTION_KEY`
  → `JWT_SECRET`; production requires an explicit key.
- **Plugins**: trusted server-side code. Tools registered by plugins cannot
  overwrite built-ins — collisions are skipped and logged.
- **Outbound timeouts**: all third-party calls default to a 10s timeout so a
  slow upstream cannot hang a request.

## Caching

Two process-local caches (nothing to back up; restartable):

- `src/lib/cache.ts` — bounded TTL map (~5000 entries). Used for analytics
  responses (`ANALYTICS_CACHE_MS`) and, optionally, authenticated user rows
  (`AUTH_USER_CACHE_MS`). Eviction is batch tournament-style to keep writes
  O(batch) rather than O(n).
- Log buffer (`src/lib/log-buffer.ts`) — bounded ring buffer of recent logs.

## Persistence model

`prisma/schema.prisma` defines: `User`, `Account` (OAuth identities),
`Session` (refresh tokens), `Conversation`, `Message`, `Memory`,
`Integration`, `Notification`. All user-owned rows are scoped by `userId` and
guarded with `{ id, userId }` where clauses (no cross-user access).
