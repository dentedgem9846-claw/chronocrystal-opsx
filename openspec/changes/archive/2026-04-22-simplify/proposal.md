## Why

Flux/kawa has accumulated dead code, misleading names, and scattered concerns that degrade codebase alignment for both AI agents and human developers. Dead branches are context pollution (agents may try to call or "fix" them), misleading names cause agents to infer wrong contracts, and split state ownership across files forces readers to hold more context than necessary. The app is small (1,245 lines) — cleaning it now prevents these patterns from compounding.

## What Changes

- **Remove dead code**: Delete the unreachable `sendOrUpdateLiveMessage` IDLE branch (silently broken — would send a non-live message if called), the unused `getBySession` method and `bySessionId` index, and the unused `AgentEvent` import from session-manager.ts.
- **Remove debris**: Delete orphaned files (`"examples storytelling cats.txt"`, `test/story.txt`) and clean `.pi/sessions/` log clutter.
- **Rename misleading methods**: `sendOrUpdateLiveMessage` → `updateLiveMessage` (it never "sends"/creates — it only updates STREAMING messages). Change return types from `Promise<ContactContext>` to `Promise<void>` since both methods mutate in-place and all callers ignore the return.
- **Co-locate concerns**: Move `extractTextFromContent` from kawa.ts to event-formatter.ts where its sibling `extractMessageText` already lives.
- **DRY repetitive casts**: Replace `ChatType.Direct as ChatType` ×4 with a single `DIRECT_CHAT_TYPE` constant.
- **Collapse trivial indirection**: Remove the private `updateLiveMessage` wrapper that just delegates to `updateLiveMessageCmd` — call `updateLiveMessageCmd` directly.

## Capabilities

### New Capabilities
- `kawa-message-sender`: Defines the live message sending API — start, update, finalize, and plain-text send — with clear ownership boundaries and no dead paths.

### Modified Capabilities
- `kawa-address-api`: No requirement changes (implementation-only cleanup, spec behavior unchanged).
- `e2e-alice-testing`: No requirement changes (test code cleanup, spec scenarios unchanged).

## Impact

- **Source files modified**: `message-sender.ts`, `session-manager.ts`, `event-formatter.ts`, `kawa.ts`
- **Files deleted**: `"examples storytelling cats.txt"`, `test/story.txt`
- **Working directory cleaned**: `.pi/sessions/` logs removed
- **No API changes**: All public method signatures remain compatible (rename is internal; `updateLiveMessage` has the same parameters minus the dead branch)
- **No spec changes**: Existing specs for `kawa-address-api` and `e2e-alice-testing` describe behavior at the spec level — the cleanup changes implementation, not requirements