# BRO

BRO is a production-quality AI assistant platform built with Node.js, TypeScript, Fastify, Prisma, PostgreSQL, and Redis.

## Architecture

BRO follows a modular, layered architecture:

- **API Layer** — Fastify with modular routing, schema validation via Zod, and OpenAPI documentation
- **Service Layer** — Business logic separated from transport
- **Data Layer** — Prisma ORM with PostgreSQL, Redis for caching and sessions
- **AI Layer** — OpenAI SDK and LangGraph for AI capabilities
- **Plugin System** — Extensible tool and plugin architecture

## Project Structure

```
bro/
├── src/
│   ├── config/          # Configuration management
│   ├── generated/       # Prisma client output
│   ├── lib/             # Shared utilities
│   ├── routes/          # Modular route handlers
│   ├── middleware/       # Shared middleware
│   ├── app.ts           # Fastify app factory
│   └── server.ts        # Server bootstrap
├── prisma/              # Database schema & migrations
├── tests/               # Test files
├── docker/              # Docker build context
├── .husky/              # Git hooks
├── .vscode/             # VS Code settings
├── docker-compose.yml   # Full stack orchestration
├── Dockerfile           # Production container
├── .env.example         # Environment variable template
└── README.md
```

## Prerequisites

- Node.js 22+
- npm 11+
- Docker Desktop (for PostgreSQL and Redis)

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your values
3. Install dependencies:
   ```bash
   npm install
   ```
4. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
5. Run database migrations:
   ```bash
   npm run prisma:migrate
   ```
6. Start the development server:
   ```bash
   npm run dev
   ```
7. Start the full stack with Docker:
   ```bash
   docker-compose up -d
   ```

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production build |
| `npm run test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint the codebase |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without modifying |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:studio` | Open Prisma Studio GUI |

## API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:3000/docs
- **OpenJSON spec**: http://localhost:3000/docs/json

## Health Check

`GET /health` — Returns the status of the application and its dependencies (database, Redis).

Each check reports `ok`, `error`, or `disabled` (a check is `disabled` when the
corresponding service is not configured). The endpoint returns `200` when every
enabled check passes and `503` when any enabled check fails.

```json
{
  "status": "ok",
  "checks": {
    "application": { "status": "ok" },
    "database": { "status": "ok", "latencyMs": 4 },
    "redis": { "status": "ok", "latencyMs": 2 }
  },
  "uptime": 12.3,
  "timestamp": "2026-08-03T00:00:00.000Z"
}
```

## License

MIT