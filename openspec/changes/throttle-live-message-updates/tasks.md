## 1. LiveMessageThrottler implementation

- [x] 1.1 Create `src/live-message-throttler.ts` with `LiveMessageThrottler` class accepting config (intervalMs)
- [x] 1.2 Implement `scheduleUpdate(ctx: ContactContext)` — buffers current `accumulatedText`, starts/resets throttle timer on `ctx.throttleTimer`
- [x] 1.3 Implement `flush(ctx: ContactContext)` — cancels pending timer, calls `sender.updateLiveMessage(ctx, ctx.accumulatedText)` immediately, clears `ctx.throttleTimer`
- [x] 1.4 Implement `cancel(ctx: ContactContext)` — cancels pending timer, clears `ctx.throttleTimer`, no update sent
- [x] 1.5 Add generation check in flush — capture `ctx.generation` before await, discard results if generation changed after await (staleness detection from safety spec)

## 2. Config changes

- [x] 1.6 Add `liveMessageUpdateIntervalMs` field to `KawaConfig` interface with default value `200`
- [x] 1.7 Add `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` env var parsing in `main()` when building config

## 3. ContactContext changes

- [x] 1.8 Add `throttleTimer: ReturnType<typeof setTimeout> | null` field to `ContactContext` interface in `src/session-manager.ts`
- [x] 1.9 Initialize `throttleTimer: null` in `createSessionForContact` and any session creation/reset paths
- [x] 1.10 Clear throttle timer in `removeByContactId` — call throttler's `cancel()` for the removed contact
- [x] 1.11 Clear throttle timer in `handleIncomingMessage` when resetting context (new prompt) — cancel before incrementing generation
- [x] 1.12 Add `lastSentText: string` field to `ContactContext` interface (for no-op flush optimization)
- [x] 1.13 Initialize `lastSentText: ""` in `createSessionForContact` and any session creation/reset paths

## 4. Wire throttler into handleAgentEvent

- [x] 2.1 Instantiate `LiveMessageThrottler` in `main()` with config.intervalMs and sender
- [x] 2.2 In `handleAgentEvent` for `message_update` when STREAMING: replace `await sender.updateLiveMessage(ctx, ctx.accumulatedText)` with `throttler.scheduleUpdate(ctx)`
- [x] 2.3 In `handleAgentEvent` for `tool_execution_start/end`: call `throttler.flush(ctx)` before `sender.updateLiveMessage(ctx, ctx.accumulatedText)` to ensure tool markers appear promptly
- [x] 2.4 In `handleAgentEvent` for `agent_end`: call `throttler.flush(ctx)` before `sender.finalizeLiveMessage(ctx)` to send any buffered updates

## 5. Markdown dialect conversion in EventFormatter

- [x] 3.1 Create `src/markdown-to-simplex.ts` with `convertMarkdownToSimplex(text: string): string` function
- [x] 3.2 Implement bold conversion: `**text**` → `*text*` (double asterisk → single asterisk)
- [x] 3.3 Implement italic conversion: `*text*` → `_text_` (single asterisk → underscore), but NOT inside `**...**` context (already handled by bold)
- [x] 3.4 Implement underscore bold conversion: `__text__` → `_text_` (double underscore → single underscore italic)
- [x] 3.5 Implement strikethrough conversion: `~~text~~` → `~text~` (double tilde → single tilde)
- [x] 3.6 Implement heading stripping: `# heading` → plain text (remove `# ` prefix, since `#` starts Secret text in SimpleX)
- [x] 3.7 Implement code block protection: skip conversion inside fenced code blocks (``` delimiters), preserve content verbatim
- [x] 3.8 Implement inline code preservation: `` `code` `` passes through unchanged
- [x] 3.9 Implement link preservation: `[text](url)` passes through unchanged
- [x] 3.10 Implement nested formatting handling: `***bold italic***` → `_*bold italic*_`
- [x] 3.11 Implement SimpleX-native passthrough: text already in SimpleX format (`_italic_`, `~strike~`) passes through unchanged (no double-conversion). `*bold*` is an ambiguous case (indistinguishable from standard `*italic*` with regex) and is treated as standard italic per the conversion rules.
- [x] 3.12 Add unit tests in `tests/markdown-to-simplex.test.ts` for all conversion rules

## 6. Integrate markdown conversion into EventFormatter

- [x] 3.13 Call `convertMarkdownToSimplex(text)` in `EventFormatter.extractMessageText()` after extracting text from the agent message, before returning
- [x] 3.14 Do NOT convert text in `formatEventAppend` — tool markers (🔧 ✓ ✗) are already in SimpleX-compatible format

## 7. System prompt for SimpleX dialect

- [x] 4.1 Create `.pi/SYSTEM.md` with SimpleX markdown dialect reference (already done: file exists with formatting rules)
- [x] 4.2 Verify pi-coding-agent loads `.pi/SYSTEM.md` by checking that `DefaultResourceLoader.discoverSystemPromptFile()` resolves to the file

## 8. Integration testing

- [x] 5.1 Add e2e test: verify throttled updates send fewer commands than unthrottled — count `updateLiveMessageCmd` calls and assert they are significantly reduced
- [x] 5.2 Add e2e test: verify first token appears immediately (no throttle delay on `startLiveMessage`)
- [x] 5.3 Add e2e test: verify tool markers flush immediately (no throttle delay on `tool_execution_start/end`)
- [x] 5.4 Add e2e test: verify `agent_end` flushes immediately and finalizes
- [x] 5.5 Add e2e test: verify timer cleanup on `/new` command (no stale timers after reset)
- [x] 5.6 Add e2e test: verify markdown conversion renders correctly in SimpleX — send bold `**text**`, verify it appears as `*text*` in the live message
- [x] 5.7 Add e2e test: verify code blocks are not converted (markdown inside ``` fences preserved as-is)
- [x] 5.8 Run `npm run check` to verify types, lint, and build pass