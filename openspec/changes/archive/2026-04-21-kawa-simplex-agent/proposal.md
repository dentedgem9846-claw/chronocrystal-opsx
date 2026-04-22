## Why

Coding agents require sitting at a terminal. Kawa is a conversational coding agent you talk to through SimpleX Chat — a privacy-first messenger. You message her from your phone or desktop, and she does the work directly. No terminal friction, no subagents, no delegation. She uses pi's AgentSession API as her coding engine, making her a first-class agent rather than a fragile tmux-scraper. Kawa surfaces tool calls (bash, read, edit) inline so you can watch her work in real-time on your phone.

## What Changes

- New Node.js/TypeScript project at `chronocrystal/flux/kawa/`:
  - Biome for formatting + linting
  - `package.json` with dependencies (`simplex-chat`, `@mariozechner/pi-coding-agent`, TypeScript)
  - `tsconfig.json` for ESM + strict mode
  - `src/kawa.ts` — main entry point
- Kawa's own `.pi/` configuration folder at `chronocrystal/flux/kawa/.pi/`:
  - `AGENTS.md` defining Kawa's identity as a coding agent accessible via chat
  - `settings.json` with model/provider settings
- Kawa uses pi's **AgentSession API** directly (in-process Node.js import from `@mariozechner/pi-coding-agent`):
  - No tmux piping, no `fs.watch()`, no `done` files
  - Structured event stream (`agent_start`, `message_update`, `agent_end`, `tool_execution_start/end`, etc.) replaces fragile output scraping
  - Prompts sent via API; responses streamed back as structured events
  - Tool calls (bash, read, edit) surfaced inline in the chat with 🔧 prefix and truncated output
- SimpleX bridge via `simplex-chat` npm SDK (`ChatClient`):
  - Kawa spawns `simplex-chat` CLI as a managed child process (`simplex-chat -p 5225`)
  - Connects via `ChatClient.create("ws://localhost:5225")` — no raw WebSocket code needed
  - Incoming `newChatItems` events → routed to per-contact AgentSession
  - Streaming via SimpleX **live messages**: `APISendMessages(live=on)` creates a live message, `APIUpdateChatItem(live=on)` updates it in-place as text deltas arrive, `APIUpdateChatItem(live=off)` finalizes on `agent_end`
  - Tool execution events appended inline: `🔧 bash: <cmd> ✓` with truncated output
  - Kawa owns the SimpleX lifecycle (start, reconnect, profile management)
- Kawa is a **SimpleX bot** (`peerType: "bot"`):
  - Configured with `--create-bot-display-name "Kawa"`
  - Slash commands: `/help`, `/reset`, `/compact`, `/status`
  - Auto-accept enabled on Kawa's address for easy connection
- Per-contact session model:
  - Each SimpleX contact gets their own pi `AgentSession`
  - Isolated conversation context per contact (max ~3 concurrent)
  - Session created on `contactConnected`, closed on `contactDeletedByContact`

## Capabilities

### New Capabilities

- `kawa-agent`: The coding agent core. Uses pi's AgentSession API to run prompts, receive structured events, and stream responses. Manages per-contact session lifecycle (creation, compaction, slash commands like `/reset` and `/compact`). Tool calls surfaced inline with 🔧 prefix and truncated output. No subagents — Kawa IS the agent.
- `simplex-bridge`: Bi-directional SimpleX Chat integration via `simplex-chat` npm SDK. Spawns and owns the `simplex-chat` CLI as a child process. Routes `newChatItems` events to per-contact AgentSessions. Streams responses using live messages (`APISendMessages`/`APIUpdateChatItem` with `liveMessage` flag). Bot profile with `peerType: "bot"`, slash commands, and auto-accept. Handles connection lifecycle, reconnection, and message formatting.

### Modified Capabilities

*(none — this is a new project)*

## Impact

- New directory `chronocrystal/flux/kawa/` containing bot source code and its own `.pi/` config
- Depends on: Node.js, `simplex-chat` npm package, `@simplex-chat/types` npm package, `@mariozechner/pi-coding-agent` npm package, `simplex-chat` CLI binary, Ollama running locally
- No modifications to the pi monorepo or existing chronocrystal project files
- The `simplex-chat` CLI binary must be downloaded and installed (standalone Haskell binary, not currently on system)