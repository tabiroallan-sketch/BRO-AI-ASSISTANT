# Troubleshooting

Common issues and their fixes. See also [MONITORING.md](MONITORING.md) for
health checks and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment-specific tips.

## Server

### "AI is not configured" (503) when chatting
Set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL` + `OPENAI_MODEL`) in
`.env` and restart. `OPENAI_BASE_URL` accepts any OpenAI-compatible endpoint
(e.g. Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`).

### Server refuses to start: "Encryption key is not configured"
`NODE_ENV=production` requires an explicit `ENCRYPTION_KEY`. Generate one:
```bash
openssl rand -hex 32
```
Set it (or `INTEGRATION_ENCRYPTION_KEY`) and restart.

### Requests fail with 429 "Too many requests"
Rate limit exceeded. Headers tell you the limit/reset; the default is
`RATE_LIMIT_MAX=100` per `RATE_LIMIT_WINDOW_MS=60000` per IP. If you're behind
a reverse proxy and want per-client limits, set `TRUST_PROXY` correctly
(otherwise everyone shares the proxy's IP). Raise the limits for load testing.

### All clients look like the proxy IP (or CORS breaks behind a proxy)
`TRUST_PROXY` defaults to `loopback`. Behind one proxy, set `TRUST_PROXY=1`
(or the proxy's IP/CIDR) so client IPs, rate limiting, and secure cookies work.
Also make sure the browser origin is in `CORS_ORIGIN` (the API rejects
cross-origin requests otherwise).

### Chat streams but the page never shows text (works via curl)
A reverse proxy is buffering the SSE response. Add `proxy_buffering off`
(Nginx) or the equivalent no-buffer setting, and make sure the connection
isn't closed early by a short idle timeout.

### Slow startup / repeated plugin errors
Plugins load in parallel and failures are isolated — check
`GET /api/v1/plugins` for a `failed` list and inspect the log. A plugin with a
tool name that collides with a built-in is skipped (logged, not fatal).

## Browser tools

### Browser tools say Chromium is not installed
```bash
npx playwright install chromium
```
In Docker the image installs it at build time. If tools still fail as
non-root, set `BROWSER_NO_SANDBOX=true` (the Docker image does this).

### Browser tools refuse a URL
The SSRF guard rejects private, loopback, and link-local addresses
(`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.x`, `::1`, …). Use a
public URL. This is intentional.

## Integrations

### Provider shows "Not configured"
Set the matching credentials in `.env` (`GOOGLE_CLIENT_ID/SECRET`,
`GITHUB_CLIENT_ID/SECRET`, `SLACK_CLIENT_ID/SECRET`,
`NOTION_CLIENT_ID/SECRET`) and restart. Each OAuth provider must also register
`<INTEGRATION_REDIRECT_BASE>/<provider-id>/callback` as an authorized redirect.

### OAuth "redirect_uri_mismatch"
Register the exact callback URL in the provider console:
`http://<host>:3000/api/v1/integrations/google-calendar/callback` (for local
dev, the default `INTEGRATION_REDIRECT_BASE`).

### Google tokens stop working
Scope or consent issues are usually the cause. Delete the integration in
Settings and reconnect. Re-authorizing issues a fresh refresh token.

### Notion "No data access"
Share a page/database with the Notion integration (Notion → Share → your
integration) so its token can read the workspace.

## Databases / caching

### Fresh data doesn't show in analytics
Analytics are cached per user for `ANALYTICS_CACHE_MS` (default 60s). Wait for
the TTL or lower the setting. The cache is process-local and resets on restart.

### User role changes don't apply immediately
`AUTH_USER_CACHE_MS` caches the user row; role changes apply after the TTL
unless invalidated by the admin route. Leave it at `0` if you change roles
often.

### Redis is down
With `REDIS_URL` unset the app uses in-memory fallbacks (sessions, rate
limiting, browser queue) and works fine. If set, Redis being down degrades
those features — check `GET /health` → `redis`.

## Tests / build

### `vitest run` crashes with "JavaScript heap out of memory"
Each worker imports Playwright. Use `--maxWorkers=1` (or fewer workers), and
set `NODE_OPTIONS=--max-old-space-size=4096` for ESLint/Next builds on
low-memory machines.

### `npx eslint` exits 134 (OOM)
Run `NODE_OPTIONS=--max-old-space-size=4096 npx eslint .`.

### Frontend: signed out repeatedly while using the app
The frontend auto-refreshes on 401; if your refresh token is also invalid
(session revoked or server restarted with a new secret), it signs you out.
Sign in again. If it happens constantly, check the clock skew on the server
and client (JWT `nbf`/`exp` validation).

### Wrong app version shown
`BRO_VERSION` (default `0.1.0`) is reported by `/health` and the web footer.

## Still stuck?

Gather: server log lines (`GET /api/v1/logs`), `GET /health` output, the exact
endpoint + request that failed, and any reverse-proxy config. Then consult the
docs or open an issue.
