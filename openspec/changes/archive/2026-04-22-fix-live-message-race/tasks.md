## 1. Add generation counter to ContactContext

- [x] 1.1 Add `generation: number` field to the `ContactContext` type definition in `session-manager.ts`
- [x] 1.2 Initialize `generation: 0` (or the next sequential value) when creating a new `ContactContext`

## 2. Synchronous state transitions in handleAgentEvent

- [x] 2.1 In the `message_update` / IDLE→STREAMING path: move `ctx.liveMessageState = "STREAMING"` before the `await sender.startLiveMessage()` call
- [x] 2.2 In the `tool_execution_start` / `tool_execution_end` paths: move `ctx.accumulatedText` append before the `await sender.updateLiveMessage()` call
- [x] 2.3 Verify all other state reads and writes in `handleAgentEvent` occur before their nearest `await` (no post-yield writes that could race)

## 3. Generation counter increments on cross-path resets

- [x] 3.1 In `handleIncomingMessage`, increment `ctx.generation` before the agent processes the new prompt
- [x] 3.2 In `handleNew`, increment `ctx.generation` on the existing context when resetting the session

## 4. Stale-event detection after async yields

- [x] 4.1 At the top of `handleAgentEvent`, capture `const gen = ctx.generation` before any `await`
- [x] 4.2 After each `await` in `handleAgentEvent`, add a generation check: `if (ctx.generation !== gen) return;`
- [x] 4.3 Ensure stale-event discard is silent — no thrown errors, no error messages sent to the contact, no side effects on the context

## 5. Dedup guard in startLiveMessage

- [x] 5.1 Add a check at the top of `startLiveMessage`: if `ctx.liveMessageState === "STREAMING"` and `ctx.liveMessageItemId !== null`, call `updateLiveMessage` with the provided text and return the existing `itemId`
- [x] 5.2 Add a `console.warn` log when the dedup guard fires (for future debugging)

## 6. E2e regression tests

- [x] 6.1 Add e2e test: single-live-message — send a prompt that triggers a multi-event agent response (tool use), wait for completion, count distinct `chatItemId`s in the response, assert exactly 1
- [x] 6.2 Add e2e test: reset-during-streaming — send a prompt, then send `/new` mid-response, verify the new session starts with fresh state (IDLE, null itemId, empty accumulatedText) and no stale state from the previous session