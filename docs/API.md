# API Reference

Base URL: `http://localhost:3000/api/v1` (configure with `NEXT_PUBLIC_API_URL`
on the frontend; the server port is `PORT`).

Interactive Swagger UI: `GET /docs` · JSON spec: `GET /docs/json`.

All endpoints that are not marked *public* require
`Authorization: Bearer <accessToken>`.

## Conventions

- Request/response bodies are JSON (`Content-Type: application/json`).
- Errors: `{ "error": { "message": "…", "code": "…" } }` with an appropriate
  HTTP status (`400`, `401`, `403`, `404`, `409`, `429`, `503`).
- `204` responses have no body.
- Ratelimit headers on `429`: `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset`, `Retry-After`.

## Public

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account `{email, password (min 8), displayName?}`. `409` if the email exists. |
| `POST` | `/auth/login` | `{email, password}` → `{accessToken, refreshToken, user}`. |
| `POST` | `/auth/refresh` | `{refreshToken}` → new token pair (rotates the presented token). Rate limited (60/min). |
| `POST` | `/auth/logout` | `{refreshToken}` — revoke it. Rate limited (60/min). |
| `GET` | `/auth/providers` | Enabled sign-in providers (`email`, plus `google` if configured). |
| `GET` | `/auth/google` | Redirect to Google OAuth. Uses PKCE (`code_challenge_method=S256`) and a signed `state` JWT (10-min TTL) stored in an `httpOnly` `oauth_state` cookie (`__Host-oauth_state` in production). Rate limited (20/min). |
| `GET` | `/auth/google/callback` | OAuth callback; verifies the signed state and exchanges the code with the PKCE verifier; redirects to the frontend with tokens in the URL fragment. Rate limited (20/min). |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `200`/`503` with per-check status (`application`, `database`, `redis`), latency, `encryptionEnabled`, uptime, version. |

## Authenticated

### Me

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/me` | Current user `{user: {id, email, displayName, avatarUrl, role}}`. |

### Conversations

| Method | Path | Description |
|---|---|---|
| `GET` | `/conversations` | List the user's conversations (newest first). |
| `POST` | `/conversations` | Create one (optional `title`); a title is derived from the first message otherwise. |
| `GET` | `/conversations/:id` | Conversation detail including `messages[]`. `404` for other users' conversations. |
| `PATCH` | `/conversations/:id` | Rename `{title}`. |
| `DELETE` | `/conversations/:id` | Delete. `204`. |

### Chat (SSE)

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | `{message (1–4000 chars), conversationId?}` → `text/event-stream`. Events: `start` (carries `conversationId`/`messageId`), `tool_start`, `tool_result`, `delta`, `done` (final message), `error`. Up to 5 tool rounds. `503` when AI or the database is not configured. |

### Memories

| Method | Path | Description |
|---|---|---|
| `GET` | `/memories` | List the user's memories (recently updated first). |
| `POST` | `/memories` | Upsert `{key (≤200), value (≤4000), category? (≤100)}`; `201` when created, `200` when updated. |
| `PATCH` | `/memories/:id` | Update `value` and/or `category` (empty body → `400`). |
| `DELETE` | `/memories/:id` | Delete. `204`. |

### Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/notifications` | Latest 50 notifications + `unreadCount`. |
| `PATCH` | `/notifications/:id/read` | Mark one read. `204`. |
| `POST` | `/notifications/read-all` | Mark all read. `204`. |

### Integrations

| Method | Path | Description |
|---|---|---|
| `GET` | `/integrations` | All providers with `connected`, `configured`, `type`, and `accountName`. |
| `GET` | `/integrations/:provider/connect` | Start OAuth (redirects to the provider). `503` if not configured. || `POST` | `/integrations/:provider` | Save webhook/token credentials (`webhookUrl` for `discord`; `token` + `phoneNumberId` for `whatsapp`; token adapters use their `fields`, e.g. `apiKey`). `201`. |
| `DELETE` | `/integrations/:provider` | Disconnect. `204`. |
| `GET` | `/integrations/marketplace` | Catalog buckets `installed` / `available` / `future` with per-item `installed`, `connected`, `configured`, and `fields`. |
| `POST` | `/integrations/marketplace/:itemId/install` | Enable a marketplace adapter server-wide. `409` for roadmap items. |
| `POST` | `/integrations/marketplace/:itemId/update` | Update status (`{updated, message}`). |
| `DELETE` | `/integrations/marketplace/:itemId` | Uninstall a marketplace adapter (or disable a bundled one). |
| `GET` | `/integrations/health` | Connection Health overview: per provider `status`/`issue`/`code`/`latencyMs`/`apiStatus`/`quota`/last sync, a `summary` rollup, monitor config, and the last sweep. |
| `PUT` | `/integrations/:provider/auto-reconnect` | Persist per-connection auto-reconnect preference (`{enabled}`). `404` if not connected. |
| `GET` | `/integrations/:provider/status` | Connection status plus persisted health and permission set. |
| `GET` | `/integrations/:provider/sync-history` | Recent sync records (`?limit=`). |

The OAuth callback is public: `GET /integrations/:provider/callback` (redirects
back to the web app with `?integration=&status=`). Rate limited (20/min).

### Tools

| Method | Path | Description |
|---|---|---|
| `GET` | `/tools` | Installed tools `{count, tools: [{name, description}]}`. |

### Plugins

| Method | Path | Description |
|---|---|---|
| `GET` | `/plugins` | Loaded plugins + manifest metadata + contributed tool names. |
| `POST` | `/plugins/reload` | *(ADMIN)* Rescan and reload all plugins. |

### Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/analytics` | Per-user counts (`conversations`, `memories`, `integrations`, `notifications`, `messages`), `messagesByRole`, and a 14-day `daily` activity array. Cached per `ANALYTICS_CACHE_MS`. |

## Admin only (requireRole `ADMIN`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/users` | List users (id, email, display name, role, active). |
| `PATCH` | `/admin/users/:id` | Update `role`/`isActive`. Cannot deactivate your own account; demoting yourself to `USER` is rejected with `400`. `404` for unknown users. |
| `GET` | `/admin/audit?limit=` | Recent audit events (newest first; capped at `AUDIT_LOG_MAX`). |
| `GET` | `/admin/secrets` | Secret configuration statuses `{count, configuredCount, encryptionEnabled, secrets: [{name, description, configured}]}`. Never returns values. Records an `admin.secrets.read` audit event. |
| `GET` | `/automations` | n8n status: `enabled`, `configured`, `workflows`, recent `executions`. Errors surface as `error` instead of failing the request. |
| `GET` | `/logs?limit=` | Recent server log entries (default 200, capped 1000). |
| `DELETE` | `/logs` | Clear the in-memory log buffer. `204`. |

## SSE stream schema

```
start:       {"type":"start","conversationId":"…","messageId":"…"}
tool_start:  {"type":"tool_start","name":"…","args":{…}}
tool_result: {"type":"tool_result","name":"…","ok":true,"output":"…"}
delta:       {"type":"delta","content":"…"}
done:        {"type":"done","message":{id,role,content,createdAt}}
error:       {"type":"error","message":"…"}
```

## Example

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"hunter2hunter"}' | jq -r .accessToken)

# Stream a chat reply
curl -N -X POST http://localhost:3000/api/v1/chat \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"What time is it in Tokyo?"}'
```
