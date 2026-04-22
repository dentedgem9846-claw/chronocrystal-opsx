## Context

Kawa is a conversational coding agent accessible through SimpleX Chat, a privacy-first messenger. Users message Kawa from their phone or desktop, and she executes coding tasks directly using pi's AgentSession API as her engine. The project lives at `chronocrystal/flux/kawa/` as a new, standalone Node.js/TypeScript package.

The current state: there is no bridge between SimpleX Chat and pi's coding agent. Users must sit at a terminal to interact with coding agents. Kawa eliminates this friction by embedding the agent inside a chat interface.

Key constraints:
- SimpleX Chat communication must go through the `simplex-chat` npm SDK (`ChatClient`), not raw WebSockets
- Kawa uses pi's `AgentSession` API in-process (Node.js import from `@mariozechner/pi-coding-agent`), not tmux scraping or subagents
- SimpleX live messages require careful state management (create → update → finalize lifecycle)
- The `simplex-chat` CLI binary must be installed on the host system; it's a standalone Haskell binary not bundled with the npm package
- Kawa is a bot (`peerType: "bot"`) — she owns her own SimpleX identity and lifecycle
- Maximum ~3 concurrent AgentSessions (one per contact) to constrain resource usage

## Goals / Non-Goals

**Goals:**
- Provide a real-time, bidirectional bridge between SimpleX Chat contacts and pi AgentSessions
- Stream agent responses as live messages so users watch work happen inline on their phone
- Surface tool execution (bash, read, edit) inline in chat with clear visual markers
- Support per-contact session isolation — each contact gets their own agent context
- Own the full SimpleX CLI lifecycle: spawn, monitor, reconnect, and graceful shutdown
- Support slash commands (`/help`, `/reset`, `/compact`, `/status`) that operate on the contact's session

**Non-Goals:**
- Multi-user authentication or access control — anyone who connects to Kawa's SimpleX address can use her
- Persistent session storage across Kawa restarts — sessions are ephemeral and in-memory
- Group chat support — Kawa operates in 1:1 direct conversations only
- File/image message handling — text messages only for v1
- Custom tool configuration per contact — all contacts share the same `.pi/` config

## Decisions

### 1. In-process AgentSession instead of tmux subprocess

**Choice**: Import `@mariozechner/pi-coding-agent` directly as an ESM module and call `AgentSession` APIs in-process.

**Alternative considered**: Spawn pi as a tmux subprocess, pipe prompts via stdin, scrape stdout with `fs.watch()` and regex.

**Rationale**: The AgentSession API provides a structured event stream (`agent_start`, `message_update`, `tool_execution_start/end`, `agent_end`) with typed payloads. No fragile output scraping, no race conditions on `done` files, no tmux session management. This is a first-class integration, not a hack.

### 2. SimpleX SDK for all protocol communication

**Choice**: Use the `simplex-chat` npm package's `ChatClient` class exclusively. No raw WebSocket code.

**Alternative considered**: Connect to the `simplex-chat` CLI websocket directly and implement the SimpleX protocol in application code.

**Rationale**: The SDK handles protocol framing, encryption, reconnection, and type safety. It exposes `apiSendMessages`, `apiUpdateChatItem`, `msgQ` (async iterator for events), and bot configuration APIs. Reimplementing this would be fragile and offer no benefit.

### 3. Managed child process for simplex-chat CLI

**Choice**: Kawa spawns `simplex-chat -p 5225` as a child process, monitors it, and restarts it on crash with configurable backoff.

**Alternative considered**: Require the user to run `simplex-chat` separately and just connect to it.

**Rationale**: Owning the lifecycle means Kawa can handle crashes automatically, ensure the port is available before connecting, and shut everything down cleanly on SIGINT/SIGTERM. Users should only need to run `npx kawa` — not manage two processes.

### 4. Per-contact session map for isolation

**Choice**: Maintain a `Map<contactId, ContactContext>` where each `ContactContext` holds an `AgentSession`, the current `chatItemId` for live message updates, and accumulated response text.

**Alternative considered**: A single shared AgentSession with conversation tagging.

**Rationale**: Shared sessions would leak context between users. Per-contact isolation is non-negotiable for a multi-user chat agent. The `ContactContext` object also serves as the state machine for live message lifecycle (tracking whether a live message is in-flight).

### 5. Live message state machine

**Choice**: A three-phase state machine per response: `IDLE → STREAMING → FINALIZED`.

- `IDLE`: No active response. First text delta transitions to STREAMING via `apiSendMessages(liveMessage: true)`.
- `STREAMING`: Active live message in flight. Subsequent deltas update via `apiUpdateChatItem(liveMessage: true)`. Tool calls appended inline.
- `FINALIZED`: `agent_end` fires, call `apiUpdateChatItem(liveMessage: false)`, transition back to IDLE.

**Alternative considered**: Buffer all text and send a single completed message on `agent_end`.

**Rationale**: Live messages are the whole point of Kawa — users watch the agent think and act in real-time. Batching undermines the experience.

### 6. Event loop architecture: single async main loop

**Choice**: A single `for await (const msg of chatClient.msgQ)` loop that processes all incoming SimpleX events sequentially. AgentSession events are handled via their own event emitters per session, with updates piped back to SimpleX using the live message API.

**Alternative considered**: A thread-per-contact model using worker threads.

**Rationale**: Node.js is single-threaded by design. AgentSessions are async (awaiting LLM responses), so concurrency comes naturally with `await`. Worker threads add complexity for minimal gain at ~3 concurrent sessions. The sequential event loop also avoids race conditions on the SimpleX message queue.

### 7. Slash commands handled before agent routing

**Choice**: In the main event loop, check if incoming text starts with `/`. If so, dispatch to a command handler. If not, route to the AgentSession.

**Alternative considered**: Let the agent handle commands as part of its prompt.

**Rationale**: Slash commands operate on session infrastructure (reset, compact, status) — they're not conversational. Routing them through the LLM would be slow, unreliable, and wasteful.

## Risks / Trade-offs

- **SimpleX CLI binary dependency** → The `simplex-chat` CLI must be pre-installed on the host. Kawa cannot bundle it. Mitigation: document installation clearly; detect missing binary at startup and fail with a helpful error message.

- **Live message size limits** → SimpleX may enforce message size limits. Long agent responses with many tool calls could exceed them. Mitigation: truncate tool output to a configurable line limit (default 5); if a response exceeds a reasonable length, split into multiple messages.

- **Concurrent session resource pressure** → Each AgentSession holds an open LLM connection. With 3 concurrent sessions, Ollama could face GPU memory pressure. Mitigation: document recommended hardware; consider queuing as a future enhancement.

- **SimpleX SDK stability** → The `simplex-chat` npm package is young; API may change. Mitigation: pin the SDK version; wrap SDK calls in a thin adapter layer so changes are localized.

- **No persistent state** → If Kawa restarts, all session context is lost. Contacts must `/reset`. Mitigation: acceptable for v1; future version could serialize session state to disk.

- **Message ordering** → If two messages arrive from the same contact in quick succession, the second must queue behind the first AgentSession prompt. Mitigation: per-contact message queue that processes sequentially; respond with a "busy" indicator if the queue depth exceeds a threshold.