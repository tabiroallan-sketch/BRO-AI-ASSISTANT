# BRO → Cross-Platform AI Operating System — Master Plan

17 additive stages. Each stage must compile, be fully tested, documented, and
approved before the next begins. The web app, chat, and existing features must
keep working — BRO is extended, never rebuilt.

## Stage 1 — Desktop Application ✅
Electron shell bundling Postgres + API + web; menus, tray, notifications,
autostart, single instance, global shortcuts, window-state persistence,
auto-update architecture, crash recovery, offline detection, graceful shutdown,
dark mode, clipboard/file picker, external links/folders, dev + production modes,
installer + packaging, docs, tests.

## Stage 2 — Background Service ✅
BRO stays alive with the window hidden. Background process, tray right-click
quick actions (Open Dashboard, Open Overlay, Start Listening, Stop Listening,
Quit), background task scheduler, heartbeat monitoring, auto-restart on crash,
memory optimization, low CPU usage.

## Stage 3 — Global Hotkeys ✅
Configurable shortcuts: `Ctrl+Space` open overlay, `Esc` hide overlay, `Alt+P`
push-to-talk, `Ctrl+Shift+B` dashboard, `Ctrl+Shift+M` toggle microphone. User
customization, conflict detection, settings UI. (Note: Windows reserves bare
modifier-only global shortcuts, so push-to-talk defaults to `Alt+P`.)

## Stage 4 — Overlay Mode ✅
Floating always-on-top transparent glass assistant with blur, drag/resize,
animations, keyboard access, voice visualization, quick prompt box,
conversation history, streaming responses, Esc to hide, instant summon,
performance-optimized.

## Stage 5 — Voice System ✅
Mic manager (device list, permission + stream acquisition, level meter), pure
energy VAD, listening engine (manual click-to-talk + push-to-talk + tray/shortcut
drivers), speech recognition + synthesis, noise reduction/echo cancellation/auto
gain via stream constraints, voice settings page (mode, devices, TTS voice,
rate, pitch, processing). Browser-first using Web Speech API + Web Audio with
graceful fallback in Electron; no new API endpoints. Wake word + continuous
always-on listening are deferred to Stage 6.

## Stage 6 — Wake Word Engine ✅
"Hey BRO" / "BRO" / "Wake up" hands-free wake-up via Web Speech keyword
spotting on continuous interim results, gated by an energy VAD pre-gate so the
recognizer only runs during speech-like audio. Confidence scoring from stable
snapshots, sensitivity slider (0.2–1), editable phrases, chime feedback,
tray toggle + IPC (`wakeWordSet`), and a BroadcastChannel leader election so
only one window arms the mic at a time. Pluggable detector interface leaves
room for an offline model later. No new API endpoints.

## Stage 7 — Conversation Engine ✅
Conversation state, follow-up questions, clarification, context retention,
intent recognition, task continuation, summaries, memory recall. Implemented as
a pure `src/conversation-engine/` module (heuristics unit-tested, no deps) with
thin LLM wiring in `index.ts`. Each turn is classified (`question`, `task`,
`chitchat`, `followup`, `continuation`, `clarification`); the system prompt
gains an intent hint, a clarification instruction for vague requests, a
relevance-ranked memory block (prefix-token scoring over the last 30
messages), and an unfinished-task reminder. Follow-up suggestions are extracted
from the reply and surfaced on the SSE `done` event and the conversation detail
endpoint. State (rolling summary, summaryMessageCount, pendingTask, suggestions)
persists in the existing `Conversation.metadata` JSONB column — no schema
migration. Summaries run async best-effort after each response (threshold 20
messages, re-summarize every 10) with provider fallback and JSON output. No new
API endpoints; chat UI shows suggestion chips and a "continued from an earlier
part" banner.

## Stage 8 — Long Term Memory
Projects, goals, clients, preferences, coding style, meetings, ideas, tasks;
relationships, importance, decay, semantic/vector search, summaries, editable
memories, timeline, viewer, management UI.

## Stage 9 — Computer Control
Launch/terminate apps, file search/folders/rename/move/delete (confirm), read
PDFs, launch VS Code/browser/terminal, shell commands (confirm), bun/npm
scripts, n8n workflows, clipboard, window management. Destructive actions
require explicit confirmation.

## Stage 10 — Automation Engine
Task planner, tool selection, multi-step execution, retries, progress tracking,
execution logs, background tasks, task queue, cancellation.

## Stage 11 — Proactive Mode
Notifications for build failures, email, calendar, client replies, GitHub
issues, low disk, high CPU, dev server stopped. Notification center, history,
priority system, quiet hours.

## Stage 12 — Desktop Dashboard
Three operating modes (Desktop / Overlay / Voice) with instant switching,
shared conversation history, memory, and settings.

## Stage 13 — Mobile Companion
Android + iOS apps: auth, secure pairing (QR), chat, voice, push notifications,
remote commands, memory access, dashboard, device status, secure communication.

## Stage 14 — Device Synchronization
Sync chats, memories, settings, integrations, notifications, tasks. Offline
sync, conflict resolution, encryption.

## Stage 15 — Security
Encrypted storage, credential vault, permission manager (desktop, microphone,
file access, automation), audit logs, security dashboard.

## Stage 16 — Performance
Startup optimization, lazy loading, background/memory/CPU optimization,
streaming optimization, telemetry, crash reporting.

## Stage 17 — Polish
Micro interactions, animations, sound effects, voice orb, holographic UI,
accessibility, keyboard navigation, responsive layouts.

## Final Stage
Full code review, dedupe, architecture improvements, complete test suite, and
documentation (developer, architecture, desktop deployment, voice, memory,
automation, plugin development, future roadmap).
