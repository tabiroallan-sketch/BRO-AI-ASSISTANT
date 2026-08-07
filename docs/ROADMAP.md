# Roadmap

Planned and aspirational work for BRO, roughly in order. Status key:
✅ shipped · 🚧 in progress · 🎯 planned · 💭 explored/considered.

## Foundations

- ✅ Modular Fastify API (auth, chat, conversations, memories, notifications,
  integrations, admin, tools, plugins, analytics, logs, automations, health).
- ✅ Web app (Next.js) with dashboard, settings, chat, memories, and admin UI.
- ✅ Streaming chat with tool calling (up to 5 rounds), abort-on-disconnect,
  and partial-save on failure.
- ✅ Plugin system with reload, validation, and collision protection.
- ✅ RBAC (USER/ADMIN), audit log, rate limiting, SSRF guard, sandboxed file
  tools, encryption at rest.
- ✅ SSE endpoints and reverse-proxy streaming support.

## AI & Assistant

- ✅ OpenAI-compatible streaming with automatic plain-completion fallback.
- ✅ Long-term memory surfaced in the system prompt.
- ✅ Integration awareness — the model knows which services are connected vs.
  available and surfaces a Connect button in chat when a tool needs an account
  that isn't connected yet.
- 🚧 Better memory management — automatic fact extraction from conversations
  (instead of only manual entries).
- 🎯 Retrieval-augmented generation (RAG) over past conversations and
  uploaded documents (vector store + embeddings).
- 🎯 Conversation summaries to extend context beyond the last 30 messages.
- 🎯 Streaming with token-usage and cost reporting per conversation.
- 💭 Local model support (Ollama) behind `OPENAI_BASE_URL` is already possible
  for chat; formal docs and a one-command setup are planned.

## Tools & Integrations

- ✅ Web search, weather, filesystem sandbox, PDF reading, clipboard,
  notifications.
- ✅ Google Calendar/Gmail/Drive/Docs/Sheets/Tasks/Contacts, GitHub, Slack, Discord, Notion, WhatsApp.
- ✅ n8n workflow orchestration and browser automation.
- 🎯 More providers: Microsoft 365, Telegram, Linear, Jira, Todoist, Teams.
- 🎯 Scheduled/triggered automations driven by n8n webhooks into BRO.
- 🎯 Upload attachments into the sandbox from the web UI.

## Platform & Reliability

- ✅ Docker Compose stack, production override, CI/CD, health checks.
- ✅ **Desktop shell (Stage 1)** — Electron app bundling Postgres + API + web:
  embedded Postgres cluster, managed service processes, tray + menus, global
  shortcuts, window-state persistence, single-instance lock, sandbox-safe
  preload bridge, GitHub-Releases auto-update wiring, NSIS installer.
- ✅ **Background service (Stage 2)** — BRO stays alive with the window hidden:
  tray right-click quick actions (Open Dashboard, Open Overlay, Start/Stop
  Listening, Quit), background task scheduler with adaptive intervals, heartbeat
  monitoring with liveness probes, auto-restart on crash (per-service cooldown),
  and low idle CPU/memory footprint.
- ✅ **Global hotkeys (Stage 3)** — five configurable global shortcuts (open/hide
  overlay, push-to-talk, open dashboard, toggle mic) with accelerator
  normalization, in-app conflict detection, OS-failure handling, per-action
  disable, and a settings card for capture + reset. Defaults follow
  `Ctrl+Space`/`Esc`/`Alt+P`/`Ctrl+Shift+B`/`Ctrl+Shift+M` (bare `Alt` is not a
  valid global shortcut on Windows, so push-to-talk uses `Alt+P`).
- ✅ **Overlay mode (Stage 4)** — a transparent, frameless, always-on-top
  `BrowserWindow` over `/overlay`: glass quick-chat with streaming responses,
  conversation history, voice-orb visualization, drag header + programmatic
  resize handle (persisted bounds, re-clamped on display change), `Esc` to hide,
  instant summon via `Ctrl+Space`, and a plain-browser fallback. Includes
  `overlay-bounds` unit tests and overlay show/resize/hide assertions in the
  desktop e2e harness.
- 🚧 Desktop hardening — Windows-only verified today (mac/Linux need their
  `@embedded-postgres` native package); auto-update needs a real GitHub
  repo/owner to publish to; per-platform crash reporting and code signing.
- 🚧 Horizontal scaling — the in-process caches and browser sessions are
  single-instance today; a shared cache (Redis) and sticky sessions or a
  distributed browser pool are the main work items.
- 🎯 PostgreSQL logical replication or a proper snapshot for the in-memory
  audit/log buffers (or move them to Postgres).
- 🎯 Structured logging with request tracing (correlation IDs).
- ✅ E2E browser tests for the web UI (Playwright against the running stack).
- 🎯 OpenTelemetry metrics endpoint (`/metrics`) for Prometheus.

## Testing & Quality

- ✅ Backend test suite — 580 tests across unit, integration, performance,
  stress, and API suites (vitest + mocked Prisma/fetch).
- ✅ Web unit tests — 100 tests for the Next.js app (libs, API client, stores,
  UI logic) via vitest.
- ✅ Web UI tests — 15 Playwright specs against the running stack (auth,
  chat, dashboard, integrations, admin-gating regression).
- ✅ OAuth tests — Google flow (PKCE + signed state, callback handling, account
  linking, tamper rejection) and disabled-provider mode.
- ✅ Provider tests — integration marketplace, hub/permissions, LLM provider
  layer, provider fallback.
- ✅ Security tests — RBAC, rate limiting, SSRF guard, secrets, encryption,
  admin self-demotion/deactivation guards.
- ✅ Regression tests — dedicated `tests/regression/` suite encoding previously
  fixed bugs (admin guards + audit-limit clamping, redis rate-limiter TTL
  correctness) and web admin-gating specs.
- 🎯 E2E backend suite against a real database (`TEST_E2E=1` with
  `DATABASE_URL`) — wiring is in place, runs in CI with Postgres/Redis.
- 🎯 Coverage thresholds enforced in CI (`c8`/`v8` coverage gates).

## Security & Privacy

- ✅ Secrets via `<NAME>_FILE` convention; explicit production encryption key.
- ✅ SSRF guard and outbound timeouts on all integrations.
- 🎯 Refresh-token family rotation with reuse detection.
- 🎯 Two-factor authentication (TOTP) and passkeys.
- 🎯 Per-user data export and account deletion.
- 🎯 Configurable per-user rate limits and admin invite-only registration.

## UX

- ✅ Dark mode, voice input/output, markdown rendering, tool bubbles.
- 🚧 Polished animations — Framer Motion micro-interactions (message/status
  entrances, sidebar active pill, layout transitions), neon glow/sweep/pulse
  utilities, glassmorphism cards, skeleton loaders, and connection/sync
  feedback in the integration hub (all respecting reduced-motion).
- 🎯 Message edit/regenerate and conversation branching.
- 🎯 Drag-and-drop file uploads (PDF/images) into chat.
- 🎯 Mobile app shell (PWA).
- 🎯 i18n beyond English.

---

Contributions are welcome — see [DEVELOPMENT.md](DEVELOPMENT.md). For
release/deploy notes see [DEPLOYMENT.md](DEPLOYMENT.md).
