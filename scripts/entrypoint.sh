#!/bin/sh
set -e

# Apply pending database migrations before starting. The server refuses to
# serve traffic on a schema it doesn't understand, so migrations run first.
if [ -x "/app/node_modules/.bin/prisma" ] && [ -f "/app/prisma/schema.prisma" ]; then
  echo "[entrypoint] Applying database migrations..."
  /app/node_modules/.bin/prisma migrate deploy --schema /app/prisma/schema.prisma
else
  echo "[entrypoint] Prisma CLI not found; skipping migrations."
fi

# Forward all arguments (the CMD) to the server.
exec "$@"
