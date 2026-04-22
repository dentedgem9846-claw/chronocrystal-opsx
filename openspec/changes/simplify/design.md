## Context

Kawa is a ~1,245-line TypeScript application that exposes a coding agent through SimpleX Chat. Its architecture comprises five modules: `SimpleXProcess` (CLI lifecycle), `SessionManager` (per-contact state), `MessageSender` (live message streaming), `EventFormatter` (agent→chat text formatting), and `CommandHandler` (slash commands), all coordinated by the `kawa.ts` main entry point.

The live message flow works as follows: when an agent starts producing output, the IDLE→STREAMING transition creates a live message via `startLiveMessage` (which uses `sendChatCmd` with `liveMessage: true`). Subsequent updates go through `sendOrUpdateLiveMessage`, which delegates to `updateLiveMessageCmd` with `liveMessage: true`. Finalization calls `updateLiveMessageCmd` with `liveMessage: false`. The `ContactContext` struct tracks state across these transitions.

Over several iterations, the codebase has accumulated:
- A dead IDLE branch in `sendOrUpdateLiveMessage` that tries to create a live message via `apiSendMessages` (which doesn't support `liveMessage: true`) — this path is never reached because `kawa.ts` always uses `startLiveMessage` for the IDLE→STREAMING transition
- An unused `getBySession` method and `bySessionId` index in `SessionManager`
- An unused `AgentEvent` import in `session-manager.ts`
- A misleading method name (`sendOrUpdateLiveMessage` implies it can create, but it only updates)
- Return types that suggest value semantics (`Promise<ContactContext>`) when all callers mutate in-place and ignore the return
- `extractTextFromContent` living in `kawa.ts` while its sibling `extractMessageText` lives in `event-formatter.ts`
- Four identical `ChatType.Direct as ChatType` casts that could be a single constant
- A private `updateLiveMessage` wrapper that adds no logic beyond delegating to `updateLiveMessageCmd`
- Orphaned test files and debris in the working directory

## Goals / Non-Goals

**Goals:**
- Remove all dead code paths so agents and developers see only reachable logic
- Make method names accurately describe their behavior
- Consolidate related text-extraction logic into a single module
- Eliminate repetitive casts with a named constant
- Flatten unnecessary indirection layers
- Remove orphaned files and debris

**Non-Goals:**
- Refactor the live message state machine itself (IDLE→STREAMING→IDLE remains the model)
- Change any public API surface or spec behavior
- Add new features or capabilities beyond what the proposal describes
- Restructure the module boundaries (MessageSender, SessionManager, etc. stay as separate files)

## Decisions

### 1. Delete the `sendOrUpdateLiveMessage` IDLE branch entirely

**Rationale:** The IDLE branch in `sendOrUpdateLiveMessage` creates a message via `apiSendMessages`, which does not support `liveMessage: true`. The actual IDLE→STREAMING transition in `kawa.ts`'s `handleAgentEvent` always calls `startLiveMessage` (which uses `sendChatCmd` with `liveMessage: true`). The IDLE branch is unreachable in practice and would produce a non-live message if somehow called — silently broken behavior. Removing it eliminates a dead path that could mislead agents into trying to "fix" it.

**Alternative considered:** Fix the IDLE branch to use `sendChatCmd` with `liveMessage: true`. Rejected because `startLiveMessage` already handles this correctly and is the only correct entry point for the transition.

### 2. Rename `sendOrUpdateLiveMessage` → `updateLiveMessage` and change return type to `Promise<void>`

**Rationale:** After removing the IDLE branch, the method only updates an existing live message. The name "sendOrUpdate" falsely implies it can create. The return type `Promise<ContactContext>` suggests the method returns a new context, but all callers mutate `ctx` in-place and discard the return value. Changing to `Promise<void>` makes the mutation contract explicit.

**Alternative considered:** Keep the old name and add a comment. Rejected because names are stronger signals than comments, especially for AI agents inferring contracts.

The same return-type change applies to `finalizeLiveMessage`, which also mutates in-place and has all callers ignoring the return.

### 3. Delete `getBySession` and `bySessionId` from `SessionManager`

**Rationale:** `bySessionId` is populated in `add()` and cleaned up in `removeByContactId()`/`closeAll()`, but `getBySession` is never called from any module. The `AgentSession→ContactContext` lookup adds memory overhead and maintenance surface for zero benefit. The sole lookup path in production code is `getByContactId`.

**Alternative considered:** Keep as "future-proofing." Rejected because YAGNI — if needed later, it's trivial to add back, and dead code is context pollution now.

### 4. Delete unused `AgentEvent` import from `session-manager.ts`

**Rationale:** The import `import type { AgentEvent } from "@mariozechner/pi-agent-core"` is unused. The module only uses `AgentSession` and `AgentSessionEvent` from `@mariozechner/pi-coding-agent`. Removing it cleans the import list.

### 5. Move `extractTextFromContent` from `kawa.ts` to `event-formatter.ts`

**Rationale:** `event-formatter.ts` already contains `extractMessageText`, which extracts text from agent messages. `extractTextFromContent` extracts text from SimpleX chat item content. Both are text-extraction functions operating on message content — they belong together. Co-locating them means readers find all text-extraction logic in one place.

**Implementation:** Move the function to `EventFormatter` as a static method (or standalone export), update the import in `kawa.ts`. The function is pure (no config dependency), so it doesn't need instance access.

### 6. Replace `ChatType.Direct as ChatType` ×4 with `DIRECT_CHAT_TYPE` constant

**Rationale:** The cast `ChatType.Direct as ChatType` appears four times in `message-sender.ts`. Each occurrence is identical and requires the reader to understand that `ChatType.Direct` is an enum member that needs widening. A named constant `DIRECT_CHAT_TYPE` expresses intent once and DRYs the repetition.

**Implementation:** Define `const DIRECT_CHAT_TYPE = ChatType.Direct as ChatType` at module top-level in `message-sender.ts`. Replace all four occurrences.

### 7. Collapse private `updateLiveMessage` wrapper → call `updateLiveMessageCmd` directly

**Rationale:** The private `updateLiveMessage(ctx)` method in `MessageSender` extracts `ctx.contactId`, `ctx.liveMessageItemId`, and `ctx.accumulatedText` from the context and passes them to `updateLiveMessageCmd` with `liveMessage: true`. It adds no logic, no validation (beyond a null check already handled at call sites), and no transformation. Callers can pass the individual fields directly.

**Implementation:** Replace all calls to `this.updateLiveMessage(ctx)` with direct calls to `this.updateLiveMessageCmd(ctx.contactId, ctx.liveMessageItemId!, ctx.accumulatedText, true)`. Remove the private method.

### 8. Delete orphaned files and `.pi/sessions/` logs

**Rationale:** `"examples storytelling cats.txt"` and `test/story.txt` are not referenced by any code, test, or documentation. They are debris from earlier exploration. `.pi/sessions/` logs are runtime clutter not tracked by git.

## Risks / Trade-offs

- **[Risk: IDLE branch was the only fallback for `startLiveMessage` failure]** → Mitigation: `startLiveMessage` already returns `{ itemId } | null`, and `handleAgentEvent` in `kawa.ts` checks the result. If `startLiveMessage` fails, the state still transitions to STREAMING but with no `itemId`, and subsequent `updateLiveMessage` calls will silently skip (the null check in the wrapper — which we're removing — or the caller can handle this). Review the failure path: if `startLiveMessage` returns null, `ctx.liveMessageItemId` stays null, and `updateLiveMessage` would need to handle that. We should add a null-guard in the direct `updateLiveMessageCmd` call or ensure the caller skips the update when `liveMessageItemId` is null.

- **[Risk: Removing `getBySession` could break unknown consumers]** → Mitigation: Confirmed via grep that no code in the repository calls `getBySession`. It's an internal module with no external consumers.

- **[Risk: Return type change could break callers that do use the return]** → Mitigation: Confirmed via grep that all call sites discard the return value. This is a TypeScript codebase — the compiler would catch any actual usage.