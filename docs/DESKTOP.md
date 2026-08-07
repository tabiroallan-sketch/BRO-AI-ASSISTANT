# Desktop Shell (Stage 1–6)

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
      shortcuts.ts               # global hotkey registry (configurable, Stage 3)
      shortcut-utils.ts          # accelerator normalize/validate/conflict checks
      overlay.ts                 # floating overlay window (transparent, Stage 4)
      overlay-bounds.ts          # overlay bounds normalize/clamp helpers
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
      services/
        scheduler.ts             # chained, non-overlapping background tasks
        heartbeat.ts             # liveness checks + auto-restart on crash
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
| `npm test` | Vitest unit suite (109 tests, no external services). |
| `npm run build:api` | Stage the API bundle into `resources/runtime/api` (compiles root, `npm ci --omit=dev`, Prisma generate). |
| `npm run build:web` | Stage the Next.js standalone bundle into `resources/runtime/web` (`BRO_DESKTOP_BUILD=1`). |
| `npm run test:e2e` | `scripts/run-e2e.mjs`: builds missing bundles, launches Electron in embedded mode, asserts bridge/config/IPC/services/health/overlay. |
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

### Background service (Stage 2)

BRO stays alive when the window is hidden to the tray:

- **Tray quick actions** (`tray.ts`): Open BRO, Open Dashboard, Open Overlay,
  Start/Stop Listening (enabled by the current listening state), Quit. The
  overlay and listening items ship their events to the renderer over the
  preload bridge (`overlay`, `commands.onListeningStart/onListeningStop`), so
  the web layer drives the actual behavior.
- **Task scheduler** (`services/scheduler.ts`): chained timers that never
  overlap — a slow cycle drops, it never queues. Intervals can be adaptive
  (a function evaluated per cycle), enabling the heartbeat's background
  throttle; timers are `unref`'d so idle CPU stays near zero.
- **Heartbeat** (`services/heartbeat.ts`): every cycle reports service states,
  probes liveness (Postgres via a 2s TCP probe on its port; the managed
  children's state is authoritative), and restarts anything that is down.
  Restarts are guarded by a per-service cooldown so a broken Postgres or API
  cannot trigger a restart loop. The interval switches from 60s to 300s while
  the window is hidden (low CPU/memory when idle). The first check runs
  immediately at startup, then on the schedule.
- **Crash recovery**: a child that dies flips to `error`/`stopped` and is
  restarted by the next heartbeat cycle; a dead Postgres is caught by the TCP
  liveness probe.

### Global hotkeys (Stage 3)

Five user-configurable shortcuts are registered with `globalShortcut` and fire
even while the window is hidden:

| Action | Default | Behavior |
|---|---|---|
| Open overlay | `Ctrl+Space` | Shows/toggles the overlay |
| Hide overlay | `Esc` | Hides the overlay |
| Push-to-talk | `Alt+P` | Push-to-talk hold: starts audio capture on key-down (Stage 5) |
| Open dashboard | `Ctrl+Shift+B` | Focuses the window on `/dashboard` |
| Toggle microphone | `Ctrl+Shift+M` | Toggles listening state |

- **Registry** (`main/shortcuts.ts`): binds actions to accelerators, re-registers
  on change (unchanged accelerators are a no-op), and never crashes on a
  malformed/OS-rejected accelerator. An empty accelerator disables an action.
- **Validation** (`main/shortcut-utils.ts`): canonicalizes modifiers/key aliases
  (`CommandOrControl`, `Cmd`/`Ctrl`, arrows), rejects modifier-only and
  multi-key combos, and detects in-app conflicts between actions.
- **Persistence + UI**: bindings live in `config.shortcuts`; the renderer
  settings page (`web/src/components/shortcuts-card.tsx`) captures key
  combinations, shows conflicts/invalid messages, supports per-action disable
  and reset-all, and live-updates via `IPC.shortcutsChanged`.
- **Design note**: Electron's `globalShortcut` throws when handed a bare
  modifier (`Alt`/`Ctrl` alone), so push-to-talk defaults to `Alt+P` instead of
  the originally-planned bare `Alt`.

### Floating overlay (Stage 4)

A second, transparent BrowserWindow over `/overlay` gives instant access to the
assistant without leaving the current app:

- **Window** (`main/overlay.ts`): lazy-created on first summon, transparent and
  frameless, always on top, `skipTaskbar`, `movable` but **not user-resizable**
  (resizing happens from the web UI via `overlay.resize`, so the drag handle can
  report pixel-accurate sizes). Position/size persist to `config.overlayBounds`
  (300ms debounce after move/resize); on a display change, bounds are re-clamped
  onto the cursor display's work area (`main/overlay-bounds.ts`, pure + unit
  tested). Hiding keeps the window alive for a snappier next summon; quitting
  destroys it.
- **Bridge**: the preload exposes `overlay.toggle/show/hide/resize/onVisibility`
  and `window.show()` (used by the overlay's "Open BRO" action to focus the main
  window on `/chat`). Listening and push-to-talk events are broadcast to both
  windows so the overlay's orb reacts to the same commands as the dashboard.
- **Web page** (`web/src/app/overlay/page.tsx`): a glass card with quick prompt,
  streaming responses (SSE), conversation history, and a voice-orb visualization
  driven by the AI state / listening events. `Esc` hides the overlay (a second
  `Esc` first closes the history panel). The header is a `-webkit-app-region:
  drag` region; interactive controls are `no-drag`. In a plain browser the page
  degrades to a centered demo (no resize handle, no bridge).
- **Shortcuts**: `Ctrl+Space` toggles the overlay, `Esc` hides it (configurable,
  Stage 3).

### Voice system (Stage 5)

The shell provides the driver events and persisted settings for the web app's
voice pipeline (mic + VAD + listening engine live in `web/src/lib/voice/`):

- **Shared contract** (`shared/desktop-api.ts`): `DesktopConfig.voice` holds
  `listeningMode` (`off`/`manual`/`ptt`), mic/output device ids, TTS enable +
  voice/rate/pitch, and the stream-processing toggles (noise suppression, echo
  cancellation, auto gain). Values round-trip through `normalizeVoiceSettings`
  (strict validation + rate/pitch clamping); `ipc.ts` sanitizes `voice` patches
  through it and `CONFIG_KEYS` includes `voice`, so invalid renderer patches are
  dropped.
- **Push-to-talk hold** (`main/index.ts`): Electron fires global shortcuts
  repeatedly while a combo is held, so each repeat restarts a **60s** safety
  timer; the renderer's VAD ends the utterance on silence, and the timer only
  guarantees a stuck "held" state can never keep the mic open indefinitely.
  Key-down broadcasts `pushToTalkStart`, timeout broadcasts `pushToTalkStop`.
- **Bridge**: the preload exposes `commands.onMicToggle`,
  `commands.onPushToTalkStart/Stop`, and the tray's
  `commands.onListeningStart/Stop`; the web `useVoice` hook wires them into the
  shared listening engine.

### Wake word (Stage 6)

Hands-free wake-up lives mostly in `web/src/lib/voice/`; the shell adds the
persisted contract, the tray toggle, and a cross-window leader election:

- **Contract** (`shared/desktop-api.ts`): `DesktopConfig.voice` now includes
  `wakeWordEnabled`, `wakeWordSensitivity` (0.2–1), `wakeWordPhrases`
  (defaults `hey bro` / `bro` / `wake up`, max 5 phrases × 40 chars), and
  `wakeWordFeedback`. `normalizeWakePhrases` lowercases/dedupes/collapses
  whitespace; `normalizeWakeSensitivity` clamps. Stage 5 configs still load —
  missing wake fields are backfilled with defaults.
- **Tray + IPC**: the tray shows a `Wake word: On/Off` item that broadcasts
  `wakeWordSet` to the renderer; the renderer persists it through the same
  `config` IPC. `ConfigStore.onDidChange` (new) lets the main process sync the
  tray label when the setting changes from the settings page.
- **Detection** (`web/src/lib/voice/wake-detector.ts`): Web Speech keyword
  spotting over continuous interim results; `findWakeMatch` enforces word
  boundaries for short phrases ("bro" won't match "broccoli"); confidence
  grows with stable snapshots and must clear `wakeThreshold(sensitivity)`.
- **Energy pre-gate** (`wake-engine.ts`): the shared VAD watches the mic level
  meter and starts/stops the recognizer around speech-like audio (1.5s grace
  after silence), so the recognizer is idle during silence/TV; 4s re-arm
  cooldown after a trigger; chime feedback via Web Audio.
- **Single-owner guarantee** (`wake-owner.ts`): a BroadcastChannel leader
  election (`bro.wake-owner.v1`, 1s heartbeats, 3s stale timeout) ensures only
  one window arms the mic; `useVoice` runs the wake engine only when this
  window owns it and the listener isn't already active.

### Dev mode

`npm run dev` runs the root API and web app with tsx/Next watch, then launches
Electron with `BRO_DESKTOP_DEV=1`. The shell then uses `DEV_API_URL`/`DEV_WEB_URL`
instead of embedded services and the embedded Postgres, giving fast iteration
with the real IPC surface.

## Known limitations (Stage 1–6)

- Windows is the verified target; mac/Linux need the matching
  `@embedded-postgres/<platform>` package and NSIS is Windows-only (mac uses
  dmg/zip, Linux uses AppImage/deb via electron-builder).
- GitHub owner/repo for `electron-builder` publishing is unresolved; packaging
  publishes conditionally on `BRO_GH_OWNER`/`BRO_GH_REPO`.
- Under the Playwright-driven e2e harness the attached inspector keeps the main
  process alive until the connection is closed; the harness force-kills as a
  backstop. Rarely, an embedded Postgres worker can survive a forced kill
  (random ports mean it never collides with the next run).
