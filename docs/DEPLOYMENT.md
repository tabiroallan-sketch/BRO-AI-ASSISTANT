# Deployment Guide

This guide covers deploying BRO as a self-hosted stack. Three options are
described, from simplest to most production-ready:

1. **Docker Compose (single host)** — the recommended starting point.
2. **Docker Compose production override** — prebuilt images, loopback-only
   ports behind a reverse proxy with TLS.
3. **GitHub Actions CI/CD** — automatic image builds + SSH deploys.

All three share the same architecture:

```
                ┌────────────┐
  browser ─────►│  Caddy/Nginx│ (TLS, :80/:443)
                └─────┬──────┘
                 ┌─────┴──────┐
        :3001    │    :3000   │
  ┌────────────┐ │ ┌────────┐ │
  │ bro-web    │◄┼─┤ bro-api │◄┼──► n8n / browser (Chromium)
  │ (Next.js)  │   └───┬────┘ │
  └────────────┘       │      │
              ┌────────┴──────┐
              │ Postgres :5432 │  Redis :6379
              └────────────────┘
```

- The **API** (`bro`) is a Fastify server on `:3000` exposing `/api/v1/*` and
  `/health`. It requires Postgres and Redis, and optionally an OpenAI-compatible
  endpoint, n8n, and Google OAuth credentials.
- The **web app** (`bro-web`) is a Next.js app on `:3001`. It talks to the API
  **from the browser**, so `NEXT_PUBLIC_API_URL` must be a URL the browser can
  reach (public domain, or `http://localhost:3000/api/v1` for local preview).

---

## Prerequisites

- Docker Engine 24+ with **Compose v2** (Docker Desktop on macOS/Windows)
- A domain + a reverse proxy for TLS (Caddy recommended) for anything beyond a
  local preview
- The `openssl` CLI to generate secrets (or any random source)

## 1. Quick start (local preview)

```bash
# 1. Configure environment
cp .env.example .env
#    - set JWT_SECRET, JWT_REFRESH_SECRET (>=32 random chars)
#    - set ENCRYPTION_KEY (>=32 random chars) — REQUIRED when NODE_ENV=production
#    - set OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL for chat
#    - set ADMIN_EMAILS=you@example.com to grant yourself the admin role

# 2. Build and start the whole stack (API + web + Postgres + Redis)
docker compose up -d --build

# 3. Open the app
open http://localhost:3001        # web UI
open http://localhost:3000/docs   # API docs (Swagger)
```

Generate secrets with:

```bash
openssl rand -hex 32   # use for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
```

The API container runs `prisma migrate deploy` on startup, so the schema is
always up to date. Check status with:

```bash
docker compose ps
docker compose logs -f app web
```

## 2. Production with Docker Compose

A production override file ships in the repo: `docker-compose.prod.yml`.

```bash
# On the server:
git clone <your-repo> bro && cd bro
cp .env.example .env
#    set NODE_ENV=production
#    set all secrets (see above) and REGISTRY + BRO_VERSION
```

Deploy:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  pull app web          # pulls prebuilt images

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --remove-orphans
```

What the override changes:

| Setting          | Dev compose      | Prod override                          |
|------------------|------------------|----------------------------------------|
| Images           | built locally    | pulled from `${REGISTRY}`              |
| `app` port       | `0.0.0.0:3000`   | `127.0.0.1:3000` (proxy only)          |
| `web` port       | `0.0.0.0:3001`   | `127.0.0.1:3001` (proxy only)          |
| Postgres/Redis   | published        | loopback only                          |
| Resource limits  | none             | memory/CPU limits per service          |

### Reverse proxy with TLS (Caddy)

`Caddyfile` (place next to the compose files):

```
your-domain.com {
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        reverse_proxy 127.0.0.1:3001
    }
}
```

Caddy automatically provisions and renews Let's Encrypt certificates:

```bash
docker run -d --name caddy \
  -p 80:80 -p 443:443 \
  -v "$PWD/Caddyfile":/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2
```

> Note: the API already sets `NODE_ENV=production`-only HSTS via helmet. The
> web app sets `Referrer-Policy`/`Permissions-Policy` etc. itself; no further
> header work is needed behind the proxy.

> The browser must reach `NEXT_PUBLIC_API_URL`. In production that means
> `https://your-domain.com/api/v1`. Because this value is inlined at **build
> time**, rebuild the `bro-web` image with the correct argument (the CD
> workflow does this automatically via `vars.NEXT_PUBLIC_API_URL`).

### No-buffer for the chat stream

`POST /api/v1/chat` is a server-sent-event stream; the client shows tokens as
they arrive. Any proxy in front of the API must **not buffer** that route or
chat will appear to "hang" until the whole answer is ready. Caddy flushes by
default for `text/event-stream`; if you see buffering, add:

```
handle /api/v1/chat* {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

For nginx, add `proxy_buffering off;` (and `proxy_cache off;`) to the
`/api/v1/chat` location. The API already sends `Cache-Control: no-cache,
no-transform` and `X-Accel-Buffering: no` on this route.

### Updates

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull app web
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f
```

Migrations apply automatically on container start (before the server accepts
traffic), so a rolling update is safe. Always back up the database first (see
`docs/BACKUP.md`).

## 3. CI/CD with GitHub Actions

Two workflows are included in `.github/workflows/`:

- **`ci.yml`** — on every push/PR: lint, formatting check, tests, and
  production builds for both the API and web, plus a Docker build of both
  images.
- **`deploy.yml`** — on push to `master`/`main` (or manual run): builds and
  pushes `bro` + `bro-web` to GHCR, then SSHes into the server and runs
  `docker compose ... up -d`.

### Setting up the deploy workflow

1. Push the repo to GitHub.
2. Create a **Personal Access Token** (or use a deploy key) with the
   `write:packages` scope so the server can `docker login` to GHCR.
3. On the server:

   ```bash
   git clone <your-repo> ~/bro && cd ~/bro
   cp .env.example .env
   # populate secrets + REGISTRY=ghcr.io/<owner>/<repo>
   ```

   The workflow sets `BRO_VERSION` itself; leave it alone in `.env`.
4. Configure Actions secrets/variables in the repo settings:
   - `vars.NEXT_PUBLIC_API_URL` — e.g. `https://your-domain.com/api/v1`
   - `secrets.DEPLOY_HOST`, `secrets.DEPLOY_USER`, `secrets.DEPLOY_SSH_KEY`,
     `secrets.DEPLOY_PORT` (optional)
5. Enable the GHCR packages `bro` and `bro-web` to be **public** if the server
   should pull without credentials, or configure the server to `docker login`
   with the PAT.

## Configuration reference

All variables are documented in `.env.example`. The ones that matter most in
production:

| Variable                  | Why it matters                                              |
|---------------------------|-------------------------------------------------------------|
| `NODE_ENV=production`     | Enables HSTS; **requires** an explicit `ENCRYPTION_KEY`     |
| `JWT_SECRET`              | Signs access tokens — rotate carefully                      |
| `JWT_REFRESH_SECRET`      | Signs refresh tokens                                        |
| `ENCRYPTION_KEY`          | AES-256-GCM key for stored integration tokens (at rest)     |
| `ADMIN_EMAILS`            | Comma-separated emails promoted to admin on login           |
| `DATABASE_URL`            | Postgres connection string                                  |
| `REDIS_URL`               | Redis connection string                                     |
| `OPENAI_API_KEY`/`BASE_URL`/`MODEL` | Chat backend                                   |
| `INTEGRATION_REDIRECT_BASE` | Public base for OAuth callbacks                          |
| `DATABASE_POOL_SIZE` / `DATABASE_POOL_TIMEOUT` | Prisma pool size (default 10) and wait timeout (5s) |
| `CACHE_TTL_MS` / `ANALYTICS_CACHE_MS` | In-process TTL cache; analytics per-user staleness |
| `AUTH_USER_CACHE_MS` | Cache auth user rows (`0` = off; role/isActive changes lag by TTL) |
| `TRUST_PROXY` | `false` / `loopback` / hop count (e.g. `1`) / proxy IP or CIDR. Controls client IP detection (rate limiting, audit) and secure cookies behind a proxy. |
| `CORS_ORIGIN` | Browser origins allowed cross-origin (default `http://localhost:3001`). Set it to your web app's public origin. |
| `BRO_VERSION` | Version reported by `/health` and the web footer (default `0.1.0`). |
| `LOG_LEVEL` | `trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent` (default `info`). |

Secrets can also be injected via `<NAME>_FILE` (e.g. `JWT_SECRET_FILE=/run/secrets/jwt`),
which is handy with Docker secrets or Kubernetes.

### Performance notes

- The analytics endpoint is cached per user for `ANALYTICS_CACHE_MS` (60s by
  default) in a process-local TTL cache (bounded ~5000 entries, evicted when
  expired or full). Cache is lost on restart and is **not** shared between
  replicas; see `docs/BACKUP.md` for what that means for state.
- `requireAuth` can cache user rows when `AUTH_USER_CACHE_MS > 0`; admin updates
  and login-time admin promotion invalidate the cached row. Keep it `0` unless
  your read:write ratio justifies slightly stale role/active state.
- Plugins load in parallel at boot; `DATABASE_POOL_SIZE` bounds Postgres
  connections per instance. For many replicas behind one database, lower it
  (e.g. 2–4) and rely on the Redis-backed rate limiter rather than memory.

## Troubleshooting

- **Container exits immediately** — check the entrypoint logs:
  `docker compose logs app | head -50`. Migrations run before startup; a wrong
  `DATABASE_URL` fails there first.
- **`FATAL: encryption key is not configured`** — set `ENCRYPTION_KEY`
  (required in production).
- **`400 Bad Request` on OAuth callbacks** — `INTEGRATION_REDIRECT_BASE` must
  match the exact redirect URIs registered with the provider, and must be
  reachable by the provider (not `localhost`).
- **Browser tools error "Failed to launch Chromium"** — the image ships
  Chromium; if you see a sandbox error, set `BROWSER_NO_SANDBOX=true`.
- **Web shows a blank login / can't reach API** — the browser must be able to
  resolve `NEXT_PUBLIC_API_URL`. Rebuild the web image with the public URL.
- **CORS errors from the browser** — set `CORS_ORIGIN` to the web app origin.

## Further reading

- `docs/BACKUP.md` — backup & restore for Postgres, Redis, and secrets
- `docs/MONITORING.md` — health checks, logs, and alerting
- `README.md` — architecture and API documentation
