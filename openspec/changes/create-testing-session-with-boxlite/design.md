## Context

Kawa is a conversational coding agent accessed through SimpleX Chat. She uses pi's `AgentSession` API as her coding engine and the `simplex-chat` npm SDK for messaging. There are known bugs in the message queue and session reset logic, and no e2e tests exist to catch regressions.

The codebase lives at `flux/kawa/` with these key files:
- `kawa.ts` — main entry point, event routing, `processQueue()` shadow queue
- `session-manager.ts` — `ContactContext` with `messageQueue`, `isProcessing` fields
- `config.ts` — `KawaConfig` with `maxQueueDepth`
- `commands.ts` — slash command handlers (`/reset` missing `session.abort()`)
- `message-sender.ts` — live message state machine
- `event-formatter.ts` — formats tool events for chat display

Pi's `AgentSession` already provides `followUp()` for queuing messages while streaming — the shadow queue is redundant and buggy.

## Goals / Non-Goals

**Goals:**
- Replace the shadow message queue with `session.followUp()` to fix the silent message loss bug
- Replace `/reset` with `/new` that properly aborts the streaming session before creating a fresh one
- Add a Kawa HTTP API (`GET /address` on port 8080) that returns the SimpleX connection address
- Build e2e smoke tests where Alice talks to a real Kawa through the SimpleX protocol, using vitest
- Test environment uses host-based process isolation: Kawa and Alice run as separate processes with isolated data directories and ports
- Both simplex-chats connect outbound to public SMP relay — matches production user experience
- After tests, processes are terminated and temp directories are cleaned up

**Non-Goals:**
- Building a general-purpose testing framework — just enough helpers for Alice's user stories
- Testing with LLM responses mocked out — the point is to find real bugs with real message flow
- Per-contact tool sandboxing (test harness runs on host, tools execute natively in Kawa's working directory)
- Custom tool routing via `Operations` overrides or `customTools` (tools run natively on host)
- Local SMP relay server — use the public relay, matching real user experience
- Parallel test execution (single sequential smoke suite is fine)

## Decisions

### D1: Replace shadow queue with `session.followUp()`

**Decision:** Delete `messageQueue`, `isProcessing`, and `processQueue()`. When a message arrives while `session.isStreaming`, call `session.followUp(text)`. When idle, call `session.prompt(text)`.

**Rationale:** The shadow queue is a broken reimplementation of what `AgentSession.followUp()` already provides. The bug: `processQueue()` calls `session.prompt()` inside the `agent_end` handler while `isStreaming` may still be true, causing a throw and silent message loss. `AgentSession.followUp()` handles this correctly — it queues the message internally and delivers it after the current turn completes. Removing the shadow queue eliminates both the bug and the need for `maxQueueDepth`.

**Alternative considered:** Fix the shadow queue's race condition — possible but pointless when `followUp()` already solves the problem correctly.

### D2: Rename `/reset` → `/new` — abort old session, create fresh one

**Decision:** Rename the `/reset` command to `/new`. `handleNew()` calls `await session.abort()` before unsubscribing the old session's event listener and creating a new `AgentSession`.

**Rationale:** "New" better describes what happens — you get a fresh session with fresh context, not a mutation of the existing one. The old session is aborted, not reset. Currently the handler just calls `unsubscribe()` on the old session, leaving the LLM streaming in the background consuming tokens. The live message is stuck because the event listener that would finalize it has been removed. `session.abort()` properly cancels the in-flight request, and `/new` makes the semantics clear.

### D3: Kawa HTTP address API on port 8080

**Decision:** Kawa exposes an HTTP endpoint `GET /address` on port 8080 that returns her SimpleX connection address as plaintext. This API starts after Kawa's bot profile setup is complete. The address is the one created by `apiCreateLink()` during startup.

**Rationale:** When someone wants to connect to Kawa, they need her SimpleX address. The cleanest way to get it is an HTTP API — poke `http://<kawa-host>:8080/address`, get the link string, connect via `apiConnectByLink()`. No stdout parsing, no shared volumes, no fragile file watching. This is both a test infrastructure feature and a production feature — real users would use the same API to discover Kawa's address.

**Alternative considered:** Shared volume (setup script writes link to file, host reads mount) — more moving parts, race conditions on file appearance, not useful in production.

**Alternative considered:** Port-forwarding the simplex-chat WebSocket for programmatic access — exposes internal infrastructure, couples test harness to SimpleX SDK internals.

### D3.1: POST /connect endpoint for programmatic connections

**Decision:** Kawa also exposes a `POST /connect` endpoint on the same HTTP server. Clients can POST a SimpleX connection link to this endpoint, and Kawa will call `apiConnectActiveUser()` to initiate the connection. This complements the `GET /address` endpoint by allowing a full programmatic connect-and-discover cycle.

**Rationale:** While `GET /address` lets clients discover Kawa's address, programmatic connection acceptance is needed for scenarios where Kawa needs to connect to a user-provided link (e.g., test infrastructure connecting to arbitrary peers, or integrations where another service orchestrates connections). The endpoint returns 200 on success, 400 for missing link, 503 if Kawa's ChatClient isn't ready, and 500 on connection failure.

### D4: Host-based process isolation for test environment

**Decision:** The test harness starts Kawa and Alice as separate host processes with isolated data directories and ports. Kawa's simplex-chat CLI runs on port 15225, Alice's on port 16225. Both connect outbound to the public SMP relay (`smp.simplex.im`). They find each other through the relay, exactly like real users.

```
┌─ Host (vitest) ──────────────────────────────────────────────┐
│                                                               │
│  test harness                                                 │
│    │                                                          │
│    │  1. Start Kawa process (dist/kawa.js)                    │
│    │     └── Data dir: /tmp/kawa-e2e-simplex                 │
│    │     └── Port: 15225                                      │
│    │     └── Address API: http://localhost:18080/address     │
│    │  2. Poll address API until ready                         │
│    │  3. Start Alice simplex-chat CLI                        │
│    │     └── Data dir: /tmp/alice-e2e-simplex                │
│    │     └── Port: 16225                                      │
│    │  4. Create Alice ChatClient on ws://localhost:16225      │
│    │  5. Alice.apiConnectByLink(link) through relay         │
│    │  6. Wait for contactConnected                             │
│    │  7. Run tests                                            │
│    │                                                          │
│    ├─ Kawa process (HTTP :18080 /address)                    │
│    │  └── simplex-chat CLI (outbound to relay)                │
│    │                                                            │
│    ├─ Alice's simplex-chat CLI (outbound to relay)           │
│    └─ SMP relay: smp.simplex.im                               │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Rationale:** Port 18080 is the only port the test harness intentionally exposes to access Kawa's address API. Everything else (SimpleX communication) happens outbound through the relay. This mirrors production: Kawa is a service that exposes an address endpoint, and clients connect through the SimpleX network.

**Alternative considered:** Micro-VM with port forwarding — would provide hardware-level sandboxing, but available micro-VM SDKs do not expose snapshot APIs and port forwarding is unreliable in some KVM environments.

### D5: Smoke test command, not regular test suite

**Decision:** Tests live under `flux/kawa/tests/e2e/` with a vitest config that sets long timeouts (60s per test). Run via `npm run smoke` (not `npm test`). Regular `npm test` remains for fast unit tests.

**Rationale:** Each test that prompts the LLM takes 5-30 seconds. A full Alice smoke suite could take 2-5 minutes. This is too slow for regular test runs but perfect for pre-release verification or bug-hunting sessions.

### D6: Create and destroy test environment per suite run

**Decision:** The test harness creates Kawa and Alice processes once in `beforeAll`, then terminates them in `afterAll`. Between individual tests, use `/new` to reset Kawa's session state. No checkpoint/rollback between tests.

**Rationale:** simplex-chat startup and Ollama warmup are the main time costs, which happen once per suite. Using `/new` between tests resets session state without recreating processes. If stronger isolation is needed in the future, we can add filesystem-level snapshot/restore of the temp data directories between tests.

**Alternative considered:** Snapshot/restore temp dirs between tests — feasible with `cp -a` but adds ~5-10s per test. Can revisit when needed.

**Alternative considered:** Destroy and recreate processes per test — too slow (simplex-chat + Ollama startup time).

## Risks / Trade-offs

**[Public SMP relay dependency]** → Mitigation: Use `smp.simplex.im` which is operated by the SimpleX team and generally reliable. If it's down, tests fail gracefully with a clear message. The relay URL should be configurable via env var for testing against alternative relays.

**[Port 18080 conflict on host]** → Mitigation: Make the port configurable via `KAWA_ADDRESS_PORT` env var (default 8080 in production, 18080 in tests). The test harness picks a high port to avoid conflicts with any locally running services.

**[LLM non-determinism makes assertions fragile]** → Mitigation: Assert on message structure and presence of key patterns (e.g., "👋", "/help", "🔧"), not exact LLM output. Use regex matchers, not string equality.

**[Address API availability race]** → Mitigation: The test harness polls `GET /address` with retries until Kawa is ready. Kawa starts the HTTP server early (before bot profile setup), so a 503 response is available immediately and a 200 means Kawa is fully initialized.

## Open Questions

1. **HTTP server implementation** — Should Kawa use Node.js's built-in `http` module, or add a lightweight dependency like `hono` or `express`? A single `GET /address` endpoint is minimal enough for the built-in `http.createServer`.

2. **Filesystem snapshot for between-test isolation** — Should we snapshot `/tmp/kawa-e2e-simplex` before the first test and restore between tests for a true clean slate? This would cost ~5-10s per restore but would be faster than recreating simplex-chat connections.
