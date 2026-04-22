## Why

Kawa has bugs that can only be found by actually running the system end-to-end. The shadow message queue silently loses messages when `processQueue()` calls `session.prompt()` while `isStreaming` is still true. The `/reset` command doesn't abort the streaming session, leaving stuck live messages and wasted tokens. We need e2e tests written from Alice's perspective to verify message flow, slash commands, and session management — using vitest as the runner with real SimpleX connections to a running Kawa instance.

The test environment runs Kawa and Alice as separate host processes with isolated data directories. Kawa has full access to bash, write, edit, read just like she would on a real user's machine. After each test suite, the processes are terminated and temp directories are cleaned up.

Kawa exposes an HTTP API on port 8080 that returns her SimpleX connection address. When someone wants to connect to Kawa, they poke that API. The test harness uses this to programmatically connect Alice to Kawa — no shared volumes or stdout parsing needed.

## What Changes

- **Delete the shadow message queue** — remove `messageQueue`, `isProcessing`, and `processQueue()` from `ContactContext` and `kawa.ts`. Replace with `session.followUp(text)` when `session.isStreaming === true` and `session.prompt(text)` when idle. The `agent_end` handler no longer drains a queue — `AgentSession` handles follow-up delivery automatically.

- **Replace `/reset` with `/new`** — rename the command and fix the abort bug. `handleNew()` calls `await session.abort()` before unsubscribing the old session's event listener and creating a new `AgentSession`. "New" better describes the semantics: fresh session, fresh context, old session properly aborted.

- **Remove `maxQueueDepth`** — the depth cap existed only because the shadow queue needed manual draining. `AgentSession.followUp()` queues without limit and drains naturally. If throttling is ever needed, it would check `session.pendingMessageCount`, but that's a future decision, not a current story.

- **Add Kawa HTTP API on port 8080** — Kawa exposes a `GET /address` endpoint that returns her SimpleX connection address as plaintext. This is how clients (including the test harness) discover how to connect to Kawa. The API starts after Kawa's bot profile is set up and the address is available.

- **Add e2e tests using vitest** — tests run Kawa and Alice as separate host processes with isolated simplex-chat data directories and ports. Both connect outbound to the public SMP relay. The test harness polls Kawa's address API to get the connection link, then connects Alice programmatically via `ChatClient.apiConnectByLink()`. After the test suite, processes are killed and temp directories are cleaned up.

## Capabilities

### New Capabilities
- `kawa-address-api`: Kawa exposes an HTTP endpoint (`GET /address` on port 8080) that returns her SimpleX connection address. This is the discovery mechanism for anyone who wants to connect to Kawa — poke the API, get the link. Used by the e2e test harness and by real clients in production.

- `e2e-alice-testing`: End-to-end tests written from Alice's perspective using vitest. Kawa and Alice each run as separate host processes with isolated data directories and ports. Both connect outbound to the public SMP relay. The test harness polls `http://localhost:18080/address` to get the connection link, then connects Alice via `apiConnectByLink()`. Verifies greeting, slash commands, coding prompts, queued message delivery, and session creation via `/new`. After tests, processes are terminated and temp directories cleaned up. Not a framework — minimal helpers over the existing SDK.

### Modified Capabilities
*(none — the queue removal is a bug fix using existing dependency APIs, not a requirement change)*

## Impact

- **`session-manager.ts`**: `ContactContext` loses `messageQueue`, `isProcessing`.
- **`kawa.ts`**: `handleIncomingMessage` simplified — `followUp()` path replaces queue logic. `processQueue()` deleted. `agent_end` handler simplified. New HTTP server on port 8080 serving `GET /address`.
- **`config.ts`**: `maxQueueDepth` removed from `KawaConfig` and `defaultConfig`. `addressApiPort` added (default 8080).
- **`commands.ts`**: `handleReset()` renamed to `handleNew()`, calls `await session.abort()` before creating a new session.
- **`message-sender.ts`**: No changes (live message pipeline unchanged).
- **`event-formatter.ts`**: No changes (tool event formatting unchanged).
- **New dev dependency**: `vitest` added to `package.json`.
- **New test directory**: `flux/kawa/tests/e2e/` with vitest config and Alice-perspective test files.
- **New `package.json` script**: `smoke` command for running e2e tests.
