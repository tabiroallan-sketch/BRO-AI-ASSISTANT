# Monitoring Guide

This guide covers how to monitor a BRO deployment: health checks, logs,
metrics, and alerting.

## What to watch

| Layer     | What                                          | Signals                                |
|-----------|-----------------------------------------------|----------------------------------------|
| API       | `/health` endpoint                            | `status: ok`, per-check `status`       |
| Web       | HTTP status of `:3001`                        | 200, response time                     |
| Postgres  | container health, disk, `pg_isready`          | uptime, volume free space              |
| Redis     | container health, `redis-cli ping`            | uptime, memory used                    |
| App logs  | pino JSON logs on stdout (`docker compose logs`) | error/warn levels, 4xx/5xx ratios  |
| Security  | `/api/v1/admin/audit`                         | unexpected admin actions, logins       |

## 1. Health checks (built in)

`GET /health` returns the status of the application, database, and Redis:

```json
{
  "status": "ok",
  "checks": {
    "application": { "status": "ok" },
    "database": { "status": "ok", "latencyMs": 4 },
    "redis": { "status": "ok", "latencyMs": 2 }
  },
  "uptime": 12.3,
  "timestamp": "2026-08-04T00:00:00.000Z"
}
```

- `200` when every enabled check is `ok`
- `503` when any enabled check is `error`
- a check is `disabled` when its service is not configured

Both container images ship a `HEALTHCHECK` that probes `/health` (API) and `/`
(web). `docker compose ps` shows the live health state.

## 2. Uptime monitoring (external)

Point an uptime service at the public URL to detect outages and get alerts:

- **Healthchecks.io** — free, simple ping-based monitoring
- **UptimeRobot** — ping/HTTP keyword checks
- **Better Stack / Grafana Cloud** — richer checks + incident management

Example UptimeRobot checks:

| Name          | URL                              | Expected |
|---------------|----------------------------------|----------|
| BRO web       | `https://your-domain.com/`       | 200      |
| BRO API       | `https://your-domain.com/api/health` | 200, contains `"ok"` |

If you expose a public health endpoint, consider wrapping `/health` in rate
limits or a proxy (it returns `503` on dependency failure, so a 5xx alert from
the checker is meaningful).

## 3. Logs

The API logs structured JSON (pino) to **stdout**. The web app logs via Next.js.

```bash
# Tail all services
docker compose logs -f --tail=200

# API only, errors
docker compose logs -f app | grep '"level":50'

# Follow into a file for archival
docker compose logs -f app > /var/log/bro-api.log
```

Useful patterns:

```bash
# 4xx/5xx responses
docker compose logs app | grep '"res":{"statusCode":5'

# Plugin load failures
docker compose logs app | grep -i 'plugin'
```

### Structured log shipping

Since logs are JSON on stdout, attach any of:

- **Promtail → Loki → Grafana** — most popular self-hosted option
- **Filebeat → Elasticsearch** — ELK stack
- **Docker Logging driver → journald / syslog / cloudwatch** — set the
  `logging:` driver on each service.

## 4. Metrics

The API does not yet expose Prometheus metrics. For resource-level monitoring
of the host and containers use:

- **cAdvisor** (per-container CPU/mem/network) + **Prometheus** + **Grafana**
- **Netdata** — zero-config, great for single hosts

```bash
# Quick one-liner: container resource usage
docker stats --no-stream
```

`docker-compose.prod.yml` sets per-service memory/CPU limits, so a container
exceeding its limit shows up as OOM-killed in `docker compose events`:

```bash
docker compose events --filter event=oom
```

## 5. Security monitoring

- **Audit log**: `GET /api/v1/admin/audit` (admin only) lists security-relevant
  events (login, refresh, OAuth, admin user changes, plugin reloads) newest
  first, capped at `AUDIT_LOG_MAX` (default 1000 in memory).
- **Rate limits**: exceeded requests return `429` with `RateLimit-*` headers;
  a spike of 429s in the logs usually means a misconfigured client or an
  attack.
- **Failed logins**: `401` from `/api/v1/auth/login` plus register events are
  all in the audit log.

## 6. Alerting suggestions

| Condition                          | Severity | Recommended check                          |
|------------------------------------|----------|--------------------------------------------|
| `/health` non-200 for > 1 min      | critical | external uptime probe                      |
| API 5xx rate > 1% over 5 min       | critical | log aggregation query + alert              |
| DB volume > 80% full               | warning  | host disk check (`df -h`) via Node Exporter |
| OOM-killed container               | critical | `docker compose events` + alert            |
| `ENCRYPTION_KEY` missing in prod   | critical | startup fails fast by design — log will show |
| Unexpected `admin.user.update`     | warning  | poll `/api/v1/admin/audit`                 |

## 7. Operational routines

- **Daily** — glance at `docker compose ps`, disk usage, and the audit log.
- **Weekly** — review error-level logs for recurring failures.
- **Monthly** — test a database restore (`docs/BACKUP.md`) and rotate
  `JWT_SECRET`/`JWT_REFRESH_SECRET` if you have a reason to (rotation invalidates
  all sessions; do it during maintenance).
- **On release** — watch `docker compose logs app` during the first minute for
  migration success and plugin load errors.
