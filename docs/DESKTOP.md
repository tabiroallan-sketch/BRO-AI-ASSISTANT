# Desktop Shell (Stage 1)

BRO ships as a cross-platform desktop app: an Electron shell that bundles
PostgreSQL, the Fastify API, and the Next.js web app into a single installable
package with no external services required. This document covers the desktop
workspace (`desktop/`), its scripts, and its architecture.

## Requirements

- Node.js 22+ (tested on 24.x), npm 11+
- Windows (primary target). The embedded Postgres binary is currently
  `@embedded-postgres/windows-x64`; other platforms need their matching native
  package in `package.json`.

## Workspace layout

```
desktop/
  src/
    shared/desktop-api.ts        # IPC contract: channels, config, reports
    main/
      index.ts                   # bootstrap: single-instance, embedded start
      config.ts                  # persisted user config (config.json)
      secret-store.ts            # encrypted secrets (AES-256-GCM, DPAPI)
      ports.ts                   # dual-stack free-port allocation
      window-state.ts            # persisted window bounds
      windows.ts                 # main window (bounds, tray-close, external nav)
      tray.ts / menus.ts         # tray icon + application menu
      shortcuts.ts               # global shortcuts (Ctrl+Shift+B/M)
      notifications.ts           # OS notifications
      updater.ts                 # GitHub Releases auto-update
      crash.ts / native.ts       # crash handling, native theme watch
      autostart.ts / connectivity.ts
      ipc.ts                     # ipcMain wiring -> window.broDesktop
      servers/
        process-manager.ts       # managed child process w/ restart breaker
        postgres-server.ts       # embedded Postgres (embedded-postgres)
        migrate.ts               # runs Prisma migrations on the API bundle
        api-server.ts            # spawns dist/server.js from the API bundle
        web-server.ts            # spawns Next.js standalone server
        server-manager.ts        # lifecycle: Postgres -> migrate -> API -> web
    preload/index.ts             # contextBridge -> window.broDesktop
  scripts/
    dev.mjs                      # dev mode: root API + web + Electron
    build-api.mjs                # stage the API runtime bundle
    build-web.mjs                # stage the Next.js standalone bundle
    build-preload.mjs            # bundle preload (sandbox-safe, single file)
    make-icons.mjs               # dependency-free PNG icon generation
    run-e2e.mjs                  # end-to-end smoke test (Playwright + Electron)
    package.mjs                  # build runtime + desktop, run electron-builder
  resources/runtime/             # staged bundles (git-ignored, built on demand)
  electron-builder.yml           # electron-builder config (NSIS + auto-update)
```

## Commands

Run from `desktop/`:

| Command | Description |
|---|---|
| `npm run dev` | Dev mode: builds/runs root API (`:3000`) + web (`:3001`), launches Electron pointing at them. No embedded Postgres. |
| `npm run build` | Type-check + compile main/preload to `dist/` (preload is bundled via esbuild). |
| `npm run typecheck` | `tsc --noEmit` over `src` + `tests`. |
| `npm test` | Vitest unit suite (43+ tests, no external services). |
| `npm run build:api` | Stage the API bundle into `resources/runtime/api` (compiles root, `npm ci --omit=dev`, Prisma generate). |
| `npm run build:web` | Stage the Next.js standalone bundle into `resources/runtime/web` (`BRO_DESKTOP_BUILD=1`). |
| `npm run test:e2e` | `scripts/run-e2e.mjs`: builds missing bundles, launches Electron in embedded mode, asserts bridge/config/IPC/services/health. |
| `npm run package` | Build runtime + desktop, then `electron-builder` (NSIS installer). Publish only when `BRO_GH_OWNER`/`BRO_GH_REPO` are set. |

## Runtime bundles

The desktop app never runs the workspace's source at runtime; it runs staged,
dependency-complete bundles so a packaged install needs no network and no
Node/Postgres install:

- **API bundle** (`resources/runtime/api`): compiled `dist/` from the root
  workspace plus its production `node_modules` (from `npm ci --omit=dev`),
  Prisma CLI + engines + generated client. Entry: `dist/server.js`.
- **Web bundle** (`resources/runtime/web`): `next build` with
  `BRO_DESKTOP_BUILD=1` selects `output: 'standalone'`; the standalone server
  (plus `.next/static` and `public`) is flattened so the entry is always
  `server.js`.

`run-e2e.mjs` and `package.mjs` rebuild these bundles when missing or stale.

## How the pieces fit

1. **Startup** (`main/index.ts`): locks the app to a single instance, then
   starts the `ServerManager` in embedded mode.
2. **ServerManager** starts services in order: Postgres (cluster persisted in
   userData `data/postgres`, port picked to be free on both IPv4 and IPv6
   stacks — avoids clashing with Docker-published `5432`), then Prisma
   migrations against that database, then the API child, then the web child.
3. **Window** loads the web URL; the preload injects `window.broDesktop` and
   `window.__BRO_API_URL__` (via `additionalArguments`), so the web app's API
   client (`web/src/lib/api.ts`) points at the embedded API without any code
   change in the web layer.
4. **Services** are managed child processes (`process-manager.ts`) with health
   probes, restart-backoff crash-loop protection, and force-kill on stop.
5. **Quit**: `will-quit` runs `stopAll()` (web, API, Postgres), capped at 30s
   so a hung embedded service can never block exit; Postgres is force-stopped
   via `pg_ctl -m immediate` as a backstop.

### Dev mode

`npm run dev` runs the root API and web app with tsx/Next watch, then launches
Electron with `BRO_DESKTOP_DEV=1`. The shell then uses `DEV_API_URL`/`DEV_WEB_URL`
instead of embedded services and the embedded Postgres, giving fast iteration
with the real IPC surface.

## Known limitations (Stage 1)

- Windows is the verified target; mac/Linux need the matching
  `@embedded-postgres/<platform>` package and NSIS is Windows-only (mac uses
  dmg/zip, Linux uses AppImage/deb via electron-builder).
- GitHub owner/repo for `electron-builder` publishing is unresolved; packaging
  publishes conditionally on `BRO_GH_OWNER`/`BRO_GH_REPO`.
- Under the Playwright-driven e2e harness the attached inspector keeps the main
  process alive until the connection is closed; the harness force-kills as a
  backstop. Rarely, an embedded Postgres worker can survive a forced kill
  (random ports mean it never collides with the next run).
