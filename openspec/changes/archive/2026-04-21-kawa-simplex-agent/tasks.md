## 1. Project Setup

- [x] 1.1 Initialize Node.js/TypeScript project at `chronocrystal/flux/kawa/` with `package.json`, `tsconfig.json` (ESM + strict mode)
- [x] 1.2 Add dependencies: `simplex-chat`, `@simplex-chat/types`, `@mariozechner/pi-coding-agent`, `typescript`, `biome`
- [x] 1.3 Configure Biome for formatting + linting in `biome.json`
- [x] 1.4 Create Kawa's `.pi/` directory at `chronocrystal/flux/kawa/.pi/` with `AGENTS.md` (agent identity) and `settings.json` (model/provider)
- [x] 1.5 Add `src/kawa.ts` entry point with basic startup logging and verify it compiles and runs

## 2. SimpleX CLI Lifecycle

- [x] 2.1 Implement `SimpleXProcess` class that spawns `simplex-chat -p <port>` as a managed child process
- [x] 2.2 Add startup wait logic that polls the WebSocket port until the CLI is ready before proceeding
- [x] 2.3 Add crash detection on the child process `exit` event with configurable exponential backoff restart
- [x] 2.4 Add graceful shutdown: listen for SIGINT/SIGTERM, terminate the child process, and exit cleanly

## 3. ChatClient Connection

- [x] 3.1 Implement `ChatClient.create("ws://localhost:5225")` connection after SimpleX CLI is ready
- [x] 3.2 Add disconnect detection on the ChatClient with exponential backoff reconnection (preserving in-flight sessions)
- [x] 3.3 Implement the main event loop: `for await (const msg of chatClient.msgQ)` that dispatches events by type

## 4. Bot Profile Configuration

- [x] 4.1 Implement first-run bot profile creation using `apiCreateActiveUser` with `peerType: "bot"` and display name "Kawa"
- [x] 4.2 Enable auto-accept on Kawa's address using `enableAddressAutoAccept()`
- [x] 4.3 Register slash commands (`/help`, `/reset`, `/compact`, `/status`) in the bot command menu

## 5. Per-Contact Session Management

- [x] 5.1 Define `ContactContext` type holding: `AgentSession`, `contactId`, current `chatItemId`, accumulated response text, and live message state (`IDLE | STREAMING`)
- [x] 5.2 Implement `sessions` map (`Map<contactId, ContactContext>`) with O(1) lookups in both directions
- [x] 5.3 Handle `contactConnected` event: create new `AgentSession` using `.pi/` config, store in map, send welcome message via `apiSendTextMessage`
- [x] 5.4 Handle `contactDeletedByContact` event: close AgentSession, remove from map
- [x] 5.5 Handle unknown contact: create AgentSession on first message if no existing session

## 6. Live Message Streaming

- [x] 6.1 Implement IDLE→STREAMING transition: on first `message_update` text delta, call `apiSendMessages(liveMessage: true)` and store the returned `chatItemId`
- [x] 6.2 Implement STREAMING updates: on subsequent text deltas, call `apiUpdateChatItem(liveMessage: true)` with accumulated text
- [x] 6.3 Implement STREAMING→IDLE finalization: on `agent_end`, call `apiUpdateChatItem(liveMessage: false)`
- [x] 6.4 Handle edge case: if `agent_end` fires with no text sent, send a fallback message via `apiSendTextMessage`
- [x] 6.5 Implement per-contact message queue so messages from the same contact are processed sequentially; respond with "busy" indicator if queue depth exceeds threshold

## 7. Tool Call Visibility

- [x] 7.1 Handle `tool_execution_start` events: append `🔧 <toolName>: <args>` to live message text
- [x] 7.2 Handle `tool_execution_end` events: append ` ✓` for success or ` ✗ <error>` for failure
- [x] 7.3 Implement tool output truncation: first N lines (configurable, default 5) + `... and X more lines`
- [x] 7.4 Handle bash tool specifically: display the command string from args; for read/edit tools, display the file path

## 8. Slash Commands

- [x] 8.1 Implement `/help` command: reply with list of available commands and their descriptions
- [x] 8.2 Implement `/reset` command: close current AgentSession, create new one for the contact, send confirmation
- [x] 8.3 Implement `/compact` command: trigger context compaction on the contact's AgentSession, send confirmation
- [x] 8.4 Implement `/status` command: query AgentSession state, respond with context usage, model, and streaming status
- [x] 8.5 Add command routing in main event loop: detect `/` prefix before AgentSession routing, dispatch to handler

## 9. Error Handling

- [x] 9.1 Handle AgentSession errors (provider unavailable, rate limit): finalize any in-flight live message, send error description to the contact
- [x] 9.2 Detect missing `simplex-chat` CLI binary at startup and fail with a helpful installation message
- [x] 9.3 Add logging throughout: SimpleX lifecycle events, session creation/closure, errors, and reconnection attempts