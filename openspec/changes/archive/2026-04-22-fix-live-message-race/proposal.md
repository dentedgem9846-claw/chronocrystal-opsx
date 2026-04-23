## Why

Kawa's async event handler has a race condition: when agent events fire rapidly, each one calls `handleAgentEvent` concurrently via fire-and-forget async. The handler reads `liveMessageState`, then yields at an `await` point (SimpleX API call), and only writes the state transition *after* the yield. The next event fires during the yield, reads stale state (IDLE), and calls `startLiveMessage` a second time — creating duplicate live messages in the chat.

But there are also cross-path races: `handleIncomingMessage` and `/new` commands mutate the same `ContactContext` while agent events are in-flight, leading to inconsistent state.

The root cause isn't "we need a queue" — it's that **state mutations happen after async yields instead of before them**. In Node.js, synchronous code between awaits is atomic. We previously removed a shadow message queue because the pi SDK's `followUp()` already handles message queuing. Adding another queue (SerialQueue) would be the same mistake. Instead, restructure the state machine so all reads and writes are synchronous (before any `await`), and add a lightweight generation counter for cross-path staleness detection.

## What Changes

- Reorder state mutations in `handleAgentEvent` to happen **before** async yields (synchronous read → write → then await), eliminating the core race condition
- Add a `generation` counter to `ContactContext`, incremented on each new prompt or `/new` command; in-flight agent events check the generation after each `await` and discard stale results
- Add a dedup guard in `startLiveMessage` that prevents creating a second live message when one is already streaming (defense in depth)
- Add e2e regression tests that send rapid messages and assert only one live message per response, and that `/new` during streaming cleanly resets state

## Capabilities

### New Capabilities

- `kawa-live-message-safety`: Synchronous state machine discipline and generation-based staleness detection for the live message lifecycle

### Modified Capabilities

- `kawa-message-sender`: Add requirement that only one live message may be active per contact at a time; `startLiveMessage` must not create a duplicate when a live message is already streaming

## Impact

- `kawa.ts` — `handleAgentEvent`: reorder state mutations before awaits; `handleIncomingMessage` / `handleNew`: increment generation counter
- `message-sender.ts` — `startLiveMessage`: add dedup guard checking existing streaming state
- `session-manager.ts` — add `generation: number` field to `ContactContext`
- `kawa-message-sender/spec.md` — updated requirements
- `tests/e2e/` — new e2e regression tests for race condition detection and live message deduplication