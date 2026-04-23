## Why

Two problems make Kawa's live messages feel slow and ugly:

1. **Token-by-token flooding.** Kawa forwards every `message_update` event as a separate `/_update item` command to SimpleX. A typical response generates 75–100+ commands, each re-sending the full accumulated text. The simplex-chat CLI processes these sequentially, creating a visible delay. Throttling into batched intervals (e.g., every 200ms) would reduce command volume by ~10–20x with no loss of information.

2. **Wrong markdown dialect.** SimpleX Chat supports markdown, but uses a different dialect from standard/CommonMark. The LLM outputs `**bold**`, but SimpleX renders `**bold**` as literal asterisks because its parser uses single delimiters: `*bold*` for bold, `_italic_` for italic, `~strike~` for strikethrough. The `#` symbol starts a "secret" (hidden text), not a heading. Kawa's `EventFormatter` sends the LLM's standard markdown directly to SimpleX, and it displays as raw syntax. The fix is to convert from standard markdown to SimpleX's markdown dialect, not to strip formatting entirely.

## What Changes

- Add a throttle/batch layer between agent `message_update` events and SimpleX `updateLiveMessageCmd` calls
- `startLiveMessage` remains immediate (first token must appear fast)
- `agent_end` and `finalizeLiveMessage` flush any pending throttled update immediately
- `tool_execution_start`/`tool_execution_end` trigger an immediate flush before appending their content (so tool markers appear promptly)
- Add `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` config option (default 200ms) controlling the throttle window
- Coalesce intermediate updates: only the latest `accumulatedText` is sent when the throttle fires, discarding stale intermediate values
- Convert standard markdown to SimpleX's markdown dialect: `**bold**` → `*bold*`, `*italic*` → `_italic_`, `~~strike~~` → `~strike~`, `# heading` → plain text (SimpleX `#` is for "secret" text), etc.
- Preserve SimpleX-compatible syntax: `` `code` ``, ````code blocks````, `[text](url)`, and Unicode emojis (🔧 ✓ ✗)
- The conversion happens in `EventFormatter.extractMessageText` so it applies to all agent output uniformly

## Capabilities

### New Capabilities
- `live-message-throttle`: Throttled delivery of live message content updates to SimpleX. Batches token-by-token `updateLiveMessage` calls into timed intervals, with immediate flush on finalization and tool markers.
- `markdown-to-simplex`: Convert agent standard/CommonMark markdown to SimpleX's markdown dialect. Transforms `**bold**` → `*bold*`, `*italic*` → `_italic_`, `~~strike~~` → `~strike~`, strips unsupported constructs like `# headings` (SimpleX uses `#` for secret/hidden text), and preserves SimpleX-compatible syntax like `` `code` ``, ````code blocks````, and `[text](url)`.

### Modified Capabilities
- `kawa-message-sender`: `updateLiveMessage` integration point changes — the throttle layer sits between `handleAgentEvent` and the raw `updateLiveMessageCmd` calls, so the MessageSender's interface needs to accommodate throttled delivery semantics.

## Impact

- **`src/message-sender.ts`**: New throttle/batch logic (likely a `LiveMessageThrottler` class or similar)
- **`src/event-formatter.ts`**: Add standard-to-SimpleX markdown dialect conversion to `extractMessageText`
- **`.pi/SYSTEM.md`**: New system prompt file telling the LLM to use SimpleX markdown dialect (`*bold*` not `**bold**`, `_italic_` not `*italic*`, etc.) so the agent produces correct formatting natively
- **`src/kawa.ts`**: `handleAgentEvent` calls throttled update instead of raw sender
- **`src/config.ts`**: New `liveMessageUpdateIntervalMs` config field
- **`src/session-manager.ts`**: `ContactContext` may need a throttle timer reference for cleanup
- **Existing `kawa-live-message-safety` spec**: Synchronous state transitions still apply — throttle layer must not break the write-before-yield invariant