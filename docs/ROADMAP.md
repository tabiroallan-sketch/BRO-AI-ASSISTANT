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
- ✅ **Computer control (Stage 9)** — OS actions with explicit confirmation for
  destructive ones: launch/terminate apps, list processes, recursive file
  search, rename/move, Recycle-Bin delete (never permanent), folder creation,
  shell commands, npm/bun scripts, clipboard read/write, browser/VS
  Code/terminal launchers, window focus/minimize. Twelve `system_*` tools;
  destructive tools emit a `tool_confirmation` SSE event and pause until
  approved via `GET /system/actions` + `POST /system/actions/:id/decision`.
  Web: Computer dashboard page + in-chat Approve/Reject bubbles.
- ✅ **Automation engine (Stage 10)** — in-memory task planner (LLM with
  heuristic fallback), multi-step execution, FIFO queue, retries with backoff,
  progress SSE streams, execution logs, cancel/retry, and pause/resume on
  explicit confirmation (`awaiting_confirmation` via the decision route).
  Per-user task store (cap 100, evicts oldest terminal tasks) with completion
  notifications reusing the existing notification store. Web: dashboard
  Automations page (create form, live task list, step/log detail, cancel/retry)
  while the admin-only n8n overview is preserved.
- ✅ **Proactive mode (Stage 11)** — per-user opt-in monitoring that turns
  signals into prioritized notifications: build command failures, dev server
  ports down, HTTP endpoint checks, low disk / high CPU, unread Gmail
  (high-priority for important senders), upcoming Calendar events, and GitHub
  issues assigned to you. Notifications carry `kind` + `priority`
  (low/medium/high/critical); quiet hours suppress low/medium and dedupe
  prevents repeats (one-shot for email/calendar/github, cooldown for stateful
  conditions). New `GET/PUT /proactive/settings`, `POST /proactive/run`,
  `GET /proactive/status` routes; notifications gained kind/priority/metadata
  + filters (`kind`/`priority`/`unread`/`limit`) + `DELETE`. Runs every 5 min
  via a configurable scheduler (`PROACTIVE_MONITOR_ENABLED` /
  `PROACTIVE_MONITOR_INTERVAL_MS`). Web: dashboard Notifications center and a
  Proactive settings page (sources, thresholds, quiet hours, important
  senders, custom monitors, run-now + status).
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
- ✅ **Voice system (Stage 5)** — browser-first voice pipeline with graceful
  Electron fallback and no new API endpoints: mic manager (device list,
  permission/stream acquisition, Web Audio level meter), pure energy VAD,
  shared listening engine (manual click-to-talk + push-to-talk with VAD
  auto-finalize, tray/shortcut drivers, live level), Web Speech recognition +
  synthesis (rate/pitch/voice), a `useVoice` hook wiring desktop command events,
  and a settings card (mode, devices, TTS, processing). `DesktopConfig.voice`
  contract + 60s PTT safety timer; wake word / continuous always-on listening
  deferred to Stage 6. Includes vad/mic/engine/settings/speech tests.
- ✅ **Wake word (Stage 6)** — hands-free "hey BRO" / "BRO" / "wake up"
  wake-up: Web Speech keyword spotting over continuous interim results with an
  energy VAD pre-gate (recognizer runs only during speech-like audio, 1.5s
  grace after silence), snapshot-stability confidence scoring, sensitivity
  slider (0.2–1 → 0.5–0.8 threshold), editable phrase list (word-boundary
  matching so "bro" doesn't match "broccoli"), chime feedback, 4s re-arm
  cooldown, tray toggle + `wakeWordSet` IPC + `ConfigStore.onDidChange`, and a
  BroadcastChannel leader election (`bro.wake-owner.v1`) so only one window
  owns the mic. Pluggable detector factory keeps an offline model a drop-in.
  Includes wake-detector/wake-engine/wake-owner tests.
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

- ✅ Backend test suite — 837 tests across unit, integration, performance,
  stress, and API suites (vitest + mocked Prisma/fetch), including the
  `src/system/` computer-control layer (43 unit + 12 route tests), the
  `src/automation/` engine (42 unit + 9 route tests), and the `src/proactive/`
  monitor layer (62 unit + 7 proactive-route + 11 notification-route tests).
- ✅ Web unit tests — 230 tests for the Next.js app (libs, API client, stores,
  UI logic, voice VAD/mic/engine/settings/wake-word, computer, automation,
  notifications + proactive clients) via vitest.
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
