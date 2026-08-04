# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder ---
# Install production + dev dependencies and compile the server to dist/.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma/
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
COPY scripts ./scripts/
COPY plugins ./plugins/
RUN npm run build

# ------------------------------------------------------------- production ---
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/plugins ./plugins
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Prisma CLI is a dev dependency; copy it so the entrypoint can run
# `prisma migrate deploy` inside the container.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Browser automation (Milestone 11): Chromium + OS dependencies.
# Chromium is launched with --no-sandbox (BROWSER_NO_SANDBOX=true) so it can
# run as the unprivileged `node` user inside the container.
RUN npx playwright install --with-deps chromium

# Entrypoint applies pending Prisma migrations, then runs the server.
COPY scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x ./scripts/entrypoint.sh

# Writable state (tool sandbox). Named volume mounted here in compose.
RUN mkdir -p /app/data/sandbox && chown -R node:node /app/data /app/plugins

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["node", "dist/server.js"]
