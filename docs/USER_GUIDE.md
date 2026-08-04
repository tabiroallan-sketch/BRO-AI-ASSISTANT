# User Guide

BRO is a personal AI assistant that streams answers, uses tools on your behalf,
remembers facts about you, and connects to the services you use.

## Signing in

1. Open the web app (`http://localhost:3001` in local installs).
2. **Register** with an email and a password (8+ characters), or sign in with
   **Google** if the administrator enabled it.
3. If your email is listed in `ADMIN_EMAILS`, you are automatically given the
   **Admin** role — you'll see an extra *Admin* page in the dashboard.

## Chat

The chat page is the main workspace.

- Type a message and press **Enter** (Shift+Enter for a new line) or click the
  send button.
- The assistant streams its reply as it is generated. If it needs to use a
  tool (search the web, check the weather, read a file, query n8n, …) you'll
  see an inline **tool bubble** showing what it is doing and the result.
- Click **New chat** to start a fresh conversation. Conversations are saved
  automatically and listed in the sidebar; click one to resume it.
- Rename or delete a conversation with the icons that appear when you hover an
  item in the sidebar.
- **Voice input**: click the mic button and speak (Chrome/Edge). **Voice
  output**: click the speaker button on any assistant message to hear it read
  aloud.

## Memory

BRO can store facts about you and use them to personalize answers.

- Open **Memories** to see what it knows.
- Add a memory: a short `key` (e.g. `name`) and its `value` (e.g. `Ada`).
  Optionally tag it with a `category` (e.g. `personal`).
- Editing a key updates it instead of creating a duplicate.
- Up to 100 of your most recently updated memories are included when you chat.

## Integrations

Connect services so BRO can act on your behalf.

- Open **Settings → Integrations**.
- **OAuth providers** (Google Calendar/Gmail/Drive, GitHub, Slack, Notion):
  click **Connect** and authorize in the provider's window.
- **Discord**: paste a channel **webhook URL** and click Save.
- **WhatsApp**: paste a WhatsApp Business **access token** and **phone number
  ID**.
- Connected services light up as usable tools in chat (e.g. "send an email",
  "list my Drive files", "post to Slack").

## Notifications

When the assistant finishes something long-running, it can leave you an
in-app notification. The bell in the navbar shows unread notifications; open
the menu to read or clear them.

## Dashboard

The **Dashboard** gives an overview of your activity and the platform:

- **Overview / Analytics** — counts of conversations, memories, integrations,
  notifications, and messages, plus a 14-day activity chart.
- **Conversations** — browse your saved conversations.
- **Memories** — manage stored facts.
- **Connected accounts** — the same integration management as Settings.
- **Installed tools** — every tool BRO can call and what it does.
- **Plugins** — installed plugins and a *Reload plugins* button.
- **Automations** — *(Admin)* n8n workflow status and recent executions.
- **Logs** — *(Admin)* recent server log lines.
- **Admin** — *(Admin)* manage users (roles, active status) and browse the
  audit log.

## Troubleshooting quick hits

- "The server is not configured for AI" — the administrator has not set an
  `OPENAI_API_KEY` (see the troubleshooting doc).
- A tool says it needs a connection — open Integrations and connect that
  provider.
- Browser tools fail — ask the administrator to install Chromium
  (`npx playwright install chromium`).
- You're signed out unexpectedly — the session expired; just sign in again.
