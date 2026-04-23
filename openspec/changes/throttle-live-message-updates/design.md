## Context

Kawa has two related problems affecting live message quality:

1. **Token-by-token flooding**: Every `message_update` event triggers an immediate `/_update item` command to simplex-chat. A typical response produces 75–100+ commands, each re-sending the full accumulated text. simplex-chat processes commands sequentially, creating a visible delay queue.

2. **Wrong markdown dialect**: SimpleX Chat supports markdown formatting, but uses a different dialect than standard/CommonMark. The LLM outputs `**bold**` (standard bold), but SimpleX's parser uses single delimiters: `*bold*` for bold, `_italic_` for italic, `~strike~` for strikethrough. The `**bold**` syntax renders as literal `**bold**` in SimpleX because its parser sees empty text between the first pair of asterisks. Kawa's `EventFormatter` sends the LLM's standard markdown directly to SimpleX without converting dialects, so all formatting appears broken to users.

**Current data flow:**
```
AgentSession → message_update event → handleAgentEvent()
  → ctx.accumulatedText = text    (synchronous state write)
  → await sender.updateLiveMessage()  (immediate I/O — every token)
  → simplex-chat CLI ← one command per token
```

The existing live message safety spec mandates synchronous state transitions (write-before-yield). The throttle and formatting layers must not break this invariant — `accumulatedText` and `liveMessageState` must still be written to `ContactContext` synchronously, and only the SimpleX I/O call is deferred or transformed.

## Goals / Non-Goals

**Goals:**
- Reduce live message update command volume by 10–20x (from ~75–100 per response to ~5–10)
- Preserve first-token-appears-fast UX: `startLiveMessage` remains immediate (no throttle)
- Preserve tool marker visibility: `tool_execution_start`/`tool_execution_end` flush immediately
- Preserve generation-based staleness detection from the safety spec
- Make throttle interval configurable via `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` env var
- Strip markdown syntax from agent output so messages look clean in SimpleX plain text
- Preserve Unicode emojis (🔧 ✓ ✗), newlines, and readable structure in output
- Clean up throttle timers on session teardown to prevent leaks

**Non-Goals:**
- Delta-based updates (SimpleX live messages require full text replacement; protocol doesn't support diffs)
- Sending rich text via `formattedText` (API doesn't support it; would require upstream changes to simplex-chat SDK)
- Changing the `MessageSender` public API (`startLiveMessage`, `updateLiveMessage`, `finalizeLiveMessage`, `sendTextMessage` signatures stay the same)
- Throttling `startLiveMessage` or `finalizeLiveMessage` — these are time-sensitive transitions that must remain immediate
- Batching across contacts (each contact has independent stream state)
- Converting markdown to SimpleX `FormattedText` format (not supported by the send API)

## Decisions

### Decision 1: Throttle layer lives in a new `LiveMessageThrottler` class

**Choice:** Create `src/live-message-throttler.ts` with a `LiveMessageThrottler` class that wraps the update path.

**Rationale:** `MessageSender` is a thin I/O wrapper over the simplex-chat SDK. Adding throttle logic there would mix transport concerns with timing concerns. A separate class keeps `MessageSender` as-is (matching the existing spec) and makes the throttle independently testable.

**Alternatives considered:**
- *Inside MessageSender*: Would require changing the spec'd API and mixing I/O with timer logic.
- *Inside handleAgentEvent*: Already has race-condition safety concerns (generation checks); adding timer logic increases complexity.

### Decision 2: Timer-based coalescing with immediate flush hooks

**Choice:** Use `setTimeout` with a configurable interval. On each `message_update`, the throttler replaces its buffered text with the latest `accumulatedText` and resets the timer. When the timer fires, one `updateLiveMessage` call is made with the latest text. Tool events and finalization flush immediately.

```
message_update event
  → ctx.accumulatedText = text        (synchronous, per safety spec)
  → throttler.scheduleUpdate(ctx)     (buffers text, starts/resets timer)
  → (timer fires ~200ms later)        → sender.updateLiveMessage(ctx)
                                        → ONE command instead of N

tool_execution_start/end event
  → ctx.accumulatedText += append      (synchronous, per safety spec)
  → throttler.flush(ctx)              (sends immediately, cancels timer)
  → sender.updateLiveMessage(ctx)     (tool markers appear promptly)

agent_end event
  → throttler.flush(ctx)              (sends any buffered update)
  → sender.finalizeLiveMessage(ctx)   (final liveMessage: false)
```

**Alternatives considered:**
- *RAF-style batching*: Not applicable in Node.js server context.
- *Character delta threshold*: Send only when N new characters accumulate. Problem: long pauses mid-response would delay updates unpredictably.
- *No throttle, just batch requests*: Would require protocol changes to SimpleX.

### Decision 3: Throttle state lives on `ContactContext`

**Choice:** Add `throttleTimer: ReturnType<typeof setTimeout> | null` to `ContactContext`.

**Rationale:** Throttle state is per-contact and per-session. When a session is torn down (new prompt, `/new`, disconnect), the timer must be cleared. Storing it on the context ensures it's always accessible alongside the `liveMessageState` it's tied to.

### Decision 4: Flush before tool markers, not after

**Choice:** When `tool_execution_start`/`tool_execution_end` fires, flush any buffered update **before** appending the tool marker text. This means the user sees streaming text pause, tool marker appears, then streaming resumes.

**Rationale:** If we flush after appending, the tool marker gets included in the buffered batch and appears delayed. Flushing before gives the marker its own distinct update.

### Decision 5: Convert standard markdown to SimpleX dialect in `EventFormatter.extractMessageText`

**Choice:** Add a markdown dialect converter inside `EventFormatter.extractMessageText` that transforms standard/CommonMark markdown to SimpleX's markdown dialect.

**Rationale:** SimpleX Chat DOES support markdown formatting, but uses a different dialect from standard/CommonMark:

| Standard Markdown | SimpleX Markdown | Effect |
|---|---|---|
| `**bold**` | `*bold*` | Bold (single asterisk) |
| `*italic*` | `_italic_` | Italic (underscore) |
| `~~strike~~` | `~strike~` | Strikethrough (single tilde) |
| `` `code` `` | `` `code` `` | Inline code (same) |
| ````code block```` | ````code block```` | Code block (same) |
| `[text](url)` | `[text](url)` | Hyperlink (same) |
| `# heading` | `HEADING` or plain text | `#` is SECRET in SimpleX, not heading |
| `> quote` | `> quote` | Quote (need to verify) |

The LLM outputs `**bold**` which SimpleX renders as literal `**bold**` because its parser sees empty text between the first pair of asterisks. Converting to SimpleX's dialect preserves formatting intent.

**Conversion rules:**
| Pattern | Conversion | Rationale |
|---------|-----------|----------|
| `**text**` | `*text*` | Double asterisk bold → single asterisk bold |
| `*text*` | `_text_` | Single asterisk italic → underscore italic |
| `__text__` | `_text_` | Double underscore bold → underscore italic |
| `_text_` | `_text_` | Already SimpleX italic format, keep |
| `~~text~~` | `~text~` | Double tilde strikethrough → single tilde |
| `` `code` `` | `` `code` `` | Inline code: same in both, keep |
| ````code block```` | ````code block```` | Code blocks: same in both, keep |
| `# heading\n` | `HEADING\n` or plain text | `#` in SimpleX starts a Secret (hidden text), not heading |
| `[text](url)` | `[text](url)` | Hyperlinks: same in both, keep |
| Unicode emojis | No change | Already work in SimpleX |

The `EventFormatter` is already responsible for formatting agent events. Adding the dialect conversion there is cohesive — all agent output text passes through this single point.

**Why not strip all formatting?** SimpleX renders `*bold*` and `_italic_` beautifully. Stripping to plain text would lose valuable visual formatting. Converting preserves the intent while matching SimpleX's expectations.

**Why not at the MessageSender level?** The sender should remain a thin I/O wrapper. Conversion is a formatting concern, and `EventFormatter` is already the formatting layer.

### Decision 6: Regex-based dialect conversion (no AST dependency)

**Choice:** Implement the markdown dialect conversion as a function in `EventFormatter` using regex patterns. No external markdown parsing library.

**Rationale:** The conversion is a predictable pattern transformation (`**` → `*`, `~~` → `~`, etc.). A lightweight regex passthrough handles this without adding a dependency like `remark` or `marked`. If the conversion needs become more complex, we can upgrade to an AST parser later.

**Edge case handling:**
- Nested formatting (`***bold italic***`): Convert to `_*bold italic*_` (bold wraps italic in SimpleX)
- Code blocks with markdown inside: Code fences and content preserved as-is (backtick syntax is the same)
- URLs in links preserved as-is (`[text](url)` is the same syntax)
- `# heading` at start of line: Convert to plain text since `#` starts a Secret in SimpleX
- Emoji pass through unchanged (already Unicode, not markdown)

### Decision 7: System prompt via `.pi/SYSTEM.md` to teach the LLM SimpleX dialect

**Choice:** Create a `SYSTEM.md` file in the `.pi/` directory that tells the LLM to use SimpleX's markdown dialect directly. Pi-coding-agent auto-discovers this file via `DefaultResourceLoader.discoverSystemPromptFile()`, which checks `<agentDir>/.pi/SYSTEM.md`.

**Rationale:** Two layers of defense: the system prompt teaches the LLM to produce correct formatting natively (`*bold*` instead of `**bold**`), and the `EventFormatter` conversion catches anything the LLM still outputs in standard markdown. This reduces the conversion workload and provides better results when both layers work together.

**Content of `.pi/SYSTEM.md`:** Documents SimpleX's markdown dialect with explicit rules:
- `*text*` for bold (NOT `**text**`)
- `_text_` for italic (NOT `*text*`)
- `~text~` for strikethrough (NOT `~~text~~`)
- \`code\` for inline code (same as standard)
- `#` is SECRET/hidden text (NOT headings)
- `!1 text!` for red, `!3 text!` for blue, etc.

**Alternatives considered:**
- *EventFormatter conversion only*: The LLM keeps producing wrong markdown, conversion has to catch everything. Higher risk of edge cases.
- *System prompt only*: If the LLM ignores or forgets the prompt, wrong formatting leaks through. Need conversion as backup.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Throttle interval too long → text appears choppy | Default 200ms is below human perception threshold for "lag" (~250ms). Configurable via env var. |
| Timer not cleaned up on session teardown → memory leak | `removeByContactId` and session reset both call `LiveMessageThrottler.cancel()`. Timer reference on `ContactContext` makes cleanup straightforward. |
| Race between timer fire and flush (e.g., timer fires after agent_end flushes) | `flush` cancels the timer synchronously. Because JavaScript's event loop is single-threaded, `clearTimeout` completes before any timer callback can fire, so the cancelled timer never executes. The callback therefore does not need an explicit `ctx.throttleTimer === null` check, though `flush()` does set it to `null`. |
| Throttle breaks write-before-yield invariant | The invariant still holds: `ctx.accumulatedText` is written synchronously before the throttler is called. Only the I/O call is deferred. |
| Network error during throttled update leaves display stale | Same error path as current code — `updateLiveMessage` silently logs and continues. No new failure mode. |
| Markdown dialect conversion has edge cases (nested, ambiguous) | Common patterns covered by explicit regex rules. Unrecognized markdown passes through (SimpleX renders as-is, which is no worse than current raw `**`). |
| Markdown conversion removes intended formatting from code blocks | Code fences and content preserved verbatim. Inline backtick code is preserved. |
| Agent model change (e.g., different markdown dialect) | Conversion is model-agnostic; handles CommonMark subset that most LLMs output. New patterns would need regex updates. |

## Open Questions

- **Minimum viable interval**: 200ms is a reasonable default, but real-world testing on different network conditions (SimpleX relay latency) may reveal a better value. Should we support a "no throttle" mode (interval=0)?
- **Markdown dialect completeness**: Should we handle ALL SimpleX formatting (colored text `!1 text!`, secrets `#text#`, commands `/command`)? Current design only converts standard markdown to SimpleX equivalents, doesn't add SimpleX-specific formatting that LLMs wouldn't output.