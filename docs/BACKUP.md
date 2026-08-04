# Backup Guide

BRO stores state in three places. All three must be backed up and restored
**together**:

| State                          | Where                                                        | Critical for                        |
|--------------------------------|--------------------------------------------------------------|-------------------------------------|
| PostgreSQL (users, chats, memories, integrations) | `bro_postgres_data` volume | Everything                        |
| Redis (rate-limit windows, sessions/queues) | `bro_redis_data` volume           | Not critical (rebuilt automatically) |
| `.env` / secrets (JWT secrets, encryption key) | on the host                     | Decrypting old backups, signing tokens |
| Integration tokens (in Postgres) | encrypted with `ENCRYPTION_KEY` | Only decryptable with that key    |

> **Important:** the `ENCRYPTION_KEY` (or `INTEGRATION_ENCRYPTION_KEY`) is
> required to decrypt stored integration access tokens. Losing it while
> keeping the database makes those tokens unrecoverable. Keep a copy of the
> `.env` file in your vault (or a password manager).

---

## What to back up

1. **Postgres database** — the authoritative source of user data.
2. **`.env` file** — secrets and configuration.
3. Optionally **`plugins/`** — if you install custom plugins, keep them in git
   or back them up too.
4. **Redis** — optional; contents (rate-limit counters, ephemeral data) are
   safe to lose. Skip it unless you need zero-downtime continuity.

## Backing up Postgres

Use `pg_dump` inside the database container. The output is a portable SQL
dump; it does not depend on the container being stopped.

```bash
# One-shot logical dump
docker compose exec -T db \
  pg_dump -U bro_user -d bro --format=custom --file=/tmp/bro.dump
docker compose cp db:/tmp/bro.dump ./backups/bro-$(date +%F).dump

# Or, without writing inside the container:
docker compose exec -T db pg_dump -U bro_user -d bro --format=custom \
  > ./backups/bro-$(date +%F).dump
```

`--format=custom` supports `pg_restore` with selective restore and is smaller
than plain SQL. For plain text: drop `--format=custom`.

## Backing up `.env` and plugins

```bash
mkdir -p backups
cp .env backups/.env.$(date +%F)
cp -r plugins backups/plugins.$(date +%F)
```

Encrypt the secrets file before storing off-host (the database dump may also
contain PII — encrypt it too):

```bash
gpg -c backups/.env.$(date +%F)        # symmetric encryption, prompts for passphrase
rm backups/.env.$(date +%F)            # keep only the .gpg file
```

## Backing up Redis (optional)

Redis data lives in `bro_redis_data`. For an RDB snapshot:

```bash
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./backups/redis-dump.rdb
```

## Automating backups

A cron job on the host (e.g. daily at 02:00) plus a retention policy:

```cron
0 2 * * * cd /srv/bro && ./scripts/backup.sh >> /var/log/bro-backup.log 2>&1
```

Keep the last 14 daily dumps and 4 weekly dumps. Offload to object storage
(`rclone copy backups s3:bro-backups`) or another machine.

## Restoring Postgres

```bash
# 1. Stop the app so it doesn't write during restore
docker compose stop app web

# 2. Restore the dump (custom format)
docker compose cp ./backups/bro-YYYY-MM-DD.dump db:/tmp/bro.dump
docker compose exec db \
  pg_restore -U bro_user -d bro --clean --if-exists /tmp/bro.dump

#    (plain-text dump:)
#   docker compose exec -T db psql -U bro_user -d bro < ./backups/bro.sql

# 3. Start the stack again
docker compose start
```

> For a **fresh install** (empty volume), use `pg_restore ... -d bro` without
> `--clean` (or `createdb` first).

## Restoring Redis (optional)

```bash
docker compose cp ./backups/redis-dump.rdb redis:/data/dump.rdb
docker compose restart redis
```

## Disaster-recovery checklist

1. Install Docker + clone the repo, recreate `.env` with the **same**
   `ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (restore from vault).
2. Start `db` and `redis`, wait for healthy.
3. Restore Postgres (above).
4. Start `app` + `web` — the API runs migrations automatically; on a fresh
   schema the restore already applied them.
5. Verify: `docker compose ps` all healthy, `curl localhost:3000/health` →
   `"status":"ok"`, then log in.

## Verify backups actually work

Test restores periodically (at least monthly) on a scratch host or a cloned
volume. A backup that has never been restored is a guess.
