FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
COPY scripts ./scripts/
RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Browser automation (Milestone 11): install Chromium + OS dependencies
RUN npx playwright install --with-deps chromium

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server.js"]
