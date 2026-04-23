## Context

Kawa uses a `subscribe(listener)` pattern from `AgentSession` that fires events asynchronously. The current listener calls `handleAgentEvent` as fire-and-forget async:

```ts
const listener = (event: AgentSessionEvent) => {
  handleAgentEvent(ctx, event, sender, formatter).catch(...)
};
```

The race condition is caused by state writes happening **after** async yields. Example:

```ts
// RACY: write happens after yield
if (ctx.liveMessageState === "IDLE") {
    const result = await sender.startLiveMessage(...);  // ← YIELDS
    if (result) ctx.liveMessageItemId = result.itemId;
    ctx.liveMessageState = "STREAMING";                  // ← WRITE AFTER YIELD
}
```

While Event 1 is awaiting `startLiveMessage`, Event 2 fires and also sees `IDLE` — calls `startLiveMessage` again = duplicate message.

We previously removed a shadow message queue because the pi SDK's `followUp()` already handles message queuing. Adding a SerialQueue would be the same mistake — a queue on top of a system that handles its own flow. Instead, fix the state machine to be atomic.

## Goals / Non-Goals

**Goals:**
- Eliminate race conditions between concurrent agent events by making state transitions synchronous
- Eliminate cross-path races (incoming message / `/new` vs in-flight agent events) via generation counter
- Ensure only one live message exists per contact at any time
- Add e2e regression tests that catch these bugs

**Non-Goals:**
- Adding a SerialQueue or any message/event queue (that's a shadow queue — we removed one already)
- Throttling or debouncing `updateLiveMessage` calls (separate optimization)
- Changing the `AgentSession.subscribe()` API or the pi SDK
- Serializing cross-contact processing (each contact has independent state)

## Decisions

### D1: Synchronous state transitions before async yields

In Node.js, synchronous code between `await` points is atomic — no other code can interleave. Move all state reads and writes to happen **before** the first `await` in each code path.

```ts
// BEFORE (racy): write after yield
if (ctx.liveMessageState === "IDLE") {
    const result = await sender.startLiveMessage(...);
    if (result) ctx.liveMessageItemId = result.itemId;
    ctx.liveMessageState = "STREAMING";
}

// AFTER (atomic): write before yield
if (ctx.liveMessageState === "IDLE") {
    ctx.liveMessageState = "STREAMING";  // ← sync write, next event can't see IDLE
    const result = await sender.startLiveMessage(...);
    if (result) ctx.liveMessageItemId = result.itemId;
}
```

**Why over SerialQueue:**

| Alternative | Why not |
|-------------|---------|
| SerialQueue (promise chain) | Shadow queue — same pattern we removed. Adds a queue on top of a system that already handles flow |
| Async queue with worker loop | Same problem, more code |
| Mutex/lock library | Adds dependency; overkill for what's a state ordering issue |

**Chosen because:** Zero new code structures. Works WITH the pi SDK's existing flow. The fix is reordering existing code — not adding a new coordination mechanism.

### D2: Generation counter for cross-path staleness

When `handleIncomingMessage` resets state or `/new` aborts a session, in-flight agent events may still write back stale results. Instead of serializing everything through a queue, add a lightweight `generation` counter:

```ts
interface ContactContext {
  // ... existing fields ...
  generation: number;  // incremented on each new prompt/new session
}
```

In-flight events capture the generation before yielding and check it after:

```ts
const gen = ctx.generation;
// ... await ...
if (ctx.generation !== gen) return;  // stale, discard
```

**Why over SerialQueue for cross-path races:**

| Alternative | Why not |
|-------------|---------|
| SerialQueue routing all mutations | Shadow queue again. The pi SDK already sequences agent work — we'd be adding a queue that the SDK doesn't need |
| `closed` boolean flag | Must be cleaned up; generation counter naturally handles multiple resets without cleanup |
| Mutex around ContactContext | Overkill; generation check is O(1) and race-free |

**Chosen because:** O(1) check, no cleanup needed, works with any number of concurrent resets. The generation is incremented in `handleIncomingMessage` (on new prompt) and `handleNew` (on session reset). Stale events silently discard.

### D3: Dedup guard in startLiveMessage

Belt-and-suspenders: if `startLiveMessage` is called while a live message is already streaming for that contact, update the existing message instead of creating a new one.

```ts
if (ctx.liveMessageState === "STREAMING" && ctx.liveMessageItemId !== null) {
    console.warn(`[msg] Already streaming for contact ${contactId}, updating instead`);
    await this.updateLiveMessage(ctx, text);
    return { itemId: ctx.liveMessageItemId };
}
```

**Why:** D1 should prevent this from ever happening, but a cheap guard prevents the bug from re-emerging if the state machine is accidentally reordered again (e.g. by a future change that moves the write back after the await).

### D4: E2e regression test strategy

Add two e2e tests:
1. **Single-live-message test**: Send a prompt that triggers a multi-event agent response (tool use), wait for completion, count distinct `chatItemId`s in the response — must be exactly 1
2. **Reset-during-streaming test**: Send a prompt, then send `/new` mid-response, verify the new session starts clean with no stale state from the previous session

**Why e2e over unit:**

| Alternative | Why not |
|-------------|---------|
| Unit test mocking `subscribe` | Doesn't catch real interleaving from the actual AgentSession |
| Timing-based test with `setTimeout` | Flaky; e2e uses real agent events |

## Risks / Trade-offs

**[startLiveMessage fails after setting STREAMING]** → If `startLiveMessage` returns null, `liveMessageItemId` stays null but state is STREAMING. Subsequent `updateLiveMessage` calls will hit the null guard and skip (no crash). `agent_end` will call `finalizeLiveMessage` which transitions back to IDLE regardless. **Mitigation:** This is the same graceful degradation already present — the message just doesn't appear, which is better than a duplicate.

**[Generation counter overflow]** → `number` in JS is safe up to 2^53. Even at 1000 resets/sec, that's 285,616 years. Not a real risk.

**[E2e tests depend on agent producing multi-event response]** → If the agent's behavior changes, the test might produce a single-event response and trivially pass. **Mitigation:** Use a prompt designed to trigger tool use (e.g. "run ls and read a file"), which reliably produces `message_update` + `tool_execution_start` + `tool_execution_end` + `agent_end`.