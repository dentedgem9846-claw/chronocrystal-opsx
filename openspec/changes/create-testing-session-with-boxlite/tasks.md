## 1. Remove Shadow Message Queue

- [x] 1.1 Delete `messageQueue`, `isProcessing`, and `isProcessing` fields from `ContactContext` interface in `session-manager.ts`
- [x] 1.2 Delete the `processQueue()` function from `kawa.ts`
- [x] 1.3 Update `agent_end` handler in `handleAgentEvent()` — remove `isProcessing = false` and the `processQueue()` call; the handler now only finalizes the live message
- [x] 1.4 Update `handleIncomingMessage()` — when `session.isStreaming === true`, call `session.followUp(text)` instead of pushing to `messageQueue`; when idle, call `session.prompt(text)` directly; remove the `isProcessing` flag and queue depth check
- [x] 1.5 Remove `maxQueueDepth` from `KawaConfig` interface and `defaultConfig` in `config.ts`; remove `KAWA_MAX_QUEUE_DEPTH` env var reading from `main()`
- [x] 1.6 Remove `maxQueueDepth` from `KawaConfig` usage in `handleIncomingMessage()` (the "too many messages queued" branch)

## 2. Replace `/reset` with `/new`

- [x] 2.1 Rename `/reset` to `/new` in `CommandHandler.handle()` switch statement
- [x] 2.2 Rename `handleReset()` method to `handleNew()`
- [x] 2.3 In `handleNew()`, call `await oldCtx.session.abort()` before `oldCtx.unsubscribe?.()` to properly cancel the in-flight LLM request — use `getByContactId()` instead of `removeByContactId()` to avoid premature unsubscribe
- [x] 2.4 If the old session was streaming, finalize any stuck live message via `sender.finalizeLiveMessage(oldCtx)` before aborting (sends `liveMessage: false` to SimpleX, not just local state clear)
- [x] 2.5 Update `/help` text — replace `/reset` with `/new` and update the description to "Start a fresh session (aborts current if streaming)"

## 3. Add Kawa HTTP Address API

- [x] 3.1 Add `addressApiPort` field to `KawaConfig` interface in `config.ts` with default value `8080`
- [x] 3.2 Read `KAWA_ADDRESS_PORT` env var in `main()` and merge into config
- [x] 3.3 Create an HTTP server using Node.js built-in `http` module in `kawa.ts` — start it in `main()` before the SimpleX event loop, listening on `config.addressApiPort`
- [x] 3.4 Implement `GET /address` route — if address is available, return it as `text/plain` with HTTP 200; if not yet available, return HTTP 503 with body "Kawa is not ready yet"
- [x] 3.5 Store the connection address (from `apiCreateLink()`) in a module-level variable so the HTTP handler can access it; set it during `setupBotProfile()` after the address is created
- [x] 3.6 Start the HTTP server early in `main()` (before SimpleX connect) so the 503 response is available immediately; the address gets populated once `setupBotProfile()` completes

## 4. E2E Test Infrastructure

- [x] 4.1 Add `vitest` as a dev dependency in `flux/kawa/package.json`
- [x] 4.3 Add `"smoke": "vitest run --config vitest.e2e.config.ts"` script to `flux/kawa/package.json`
- [x] 4.4 Create `flux/kawa/vitest.e2e.config.ts` — set `testTimeout` to 60000, `hookTimeout` to 120000, test match pattern for `tests/e2e/**/*.test.ts`
- [x] 4.5 Create `flux/kawa/tests/e2e/setup.ts` — black-box test setup: starts Kawa via env vars only (no wrapper script), starts Alice simplex-chat with wrapper, polls `GET /address`, connects Alice, waits for greeting
- [x] 4.6 Create `flux/kawa/tests/e2e/helpers.ts` — `send(text)` that calls `apiSendTextMessage()`, and `waitForMessage(matcher, timeoutMs)` that polls `aliceHistory` until a message matches or throws on timeout
- [x] 4.7 Platform detection checks for `simplex-chat` CLI availability and Ollama — fail loudly with descriptive error, do not skip silently

## 5. E2E Test User Stories

- [x] 5.1 Create `flux/kawa/tests/e2e/greeting.test.ts` — Alice connects; `waitForMessage` matches `👋`; assert greeting identifies Kawa as a coding agent
- [x] 5.2 Create `flux/kawa/tests/e2e/help.test.ts` — Alice sends `/help`; assert response contains `/help`, `/new`, `/compact`, `/status`
- [x] 5.3 Create `flux/kawa/tests/e2e/simple-prompt.test.ts` — Alice sends "What is 2+2?"; assert response addresses the question (matches `/\b4\b|four/i`), with fallback for "(Agent finished with no output)"
- [x] 5.4 Create `flux/kawa/tests/e2e/code-execution.test.ts` — Alice sends coding prompt; verify Kawa processes without error; if `🔧` appears, assert `hello.txt` is mentioned
- [x] 5.5 Create `flux/kawa/tests/e2e/queued-messages.test.ts` — Alice sends two messages in quick succession while Kawa is streaming; verify both messages receive responses (no silent loss)
- [x] 5.6 Create `flux/kawa/tests/e2e/new-command.test.ts` — test `/new` while idle: assert fresh session confirmation; test `/new` while streaming: send a prompt, then immediately send `/new`, assert session aborted and new session confirmed

## 6. Black-Box Test Isolation & Configuration

- [x] 6.1 Add `botDisplayName` to `KawaConfig` with default `"Kawa"` and env var `KAWA_BOT_DISPLAY_NAME`
- [x] 6.2 Add `simplexDataDir` to `KawaConfig` with default `""` (use simplex-chat default) and env var `KAWA_SIMPLEX_DATA_DIR`
- [x] 6.3 Pass `--create-bot-display-name` and `-d` (when configured) flags to simplex-chat in `SimpleXProcess.spawnProcess()`
- [x] 6.4 Remove Kawa wrapper script from test setup — pass `KAWA_SIMPLEX_DATA_DIR` env var instead of wrapping the binary
- [x] 6.5 Add prerequisite checks (`simplex-chat`, `ollama`) that fail loudly in test setup
- [x] 6.6 Add temp directory cleanup to `teardownShared()` for all created dirs and wrapper scripts
- [x] 6.7 Add operational scripts: `scripts/clean.sh`, `scripts/check.sh`, `scripts/start.sh`, `scripts/stop.sh` and corresponding `npm run` commands
