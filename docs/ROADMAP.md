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
- ✅ Google Calendar/Gmail/Drive, GitHub, Slack, Discord, Notion, WhatsApp.
- ✅ n8n workflow orchestration and browser automation.
- 🎯 More providers: Microsoft 365, Telegram, Linear, Jira, Todoist, Teams.
- 🎯 Scheduled/triggered automations driven by n8n webhooks into BRO.
- 🎯 Upload attachments into the sandbox from the web UI.

## Platform & Reliability

- ✅ Docker Compose stack, production override, CI/CD, health checks.
- 🚧 Horizontal scaling — the in-process caches and browser sessions are
  single-instance today; a shared cache (Redis) and sticky sessions or a
  distributed browser pool are the main work items.
- 🎯 PostgreSQL logical replication or a proper snapshot for the in-memory
  audit/log buffers (or move them to Postgres).
- 🎯 Structured logging with request tracing (correlation IDs).
- 🎯 E2E browser tests for the web UI (Playwright against the running stack).
- 🎯 OpenTelemetry metrics endpoint (`/metrics`) for Prometheus.

## Security & Privacy

- ✅ Secrets via `<NAME>_FILE` convention; explicit production encryption key.
- ✅ SSRF guard and outbound timeouts on all integrations.
- 🎯 Refresh-token family rotation with reuse detection.
- 🎯 Two-factor authentication (TOTP) and passkeys.
- 🎯 Per-user data export and account deletion.
- 🎯 Configurable per-user rate limits and admin invite-only registration.

## UX

- ✅ Dark mode, voice input/output, markdown rendering, tool bubbles.
- 🎯 Message edit/regenerate and conversation branching.
- 🎯 Drag-and-drop file uploads (PDF/images) into chat.
- 🎯 Mobile app shell (PWA).
- 🎯 i18n beyond English.

---

Contributions are welcome — see [DEVELOPMENT.md](DEVELOPMENT.md). For
release/deploy notes see [DEPLOYMENT.md](DEPLOYMENT.md).
