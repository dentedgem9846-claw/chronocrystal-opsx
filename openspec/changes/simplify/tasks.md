## 1. Remove Dead Code

- [x] 1.1 Delete the unreachable IDLE branch from `sendOrUpdateLiveMessage` in `message-sender.ts` (the branch that creates via `apiSendMessages` — never reached because `kawa.ts` always uses `startLiveMessage` for IDLE→STREAMING)
- [x] 1.2 Delete the `getBySession` method and `bySessionId` index from `SessionManager` in `session-manager.ts`
- [x] 1.3 Delete the unused `AgentEvent` import from `session-manager.ts`

## 2. Rename and Return-Type Cleanup

- [x] 2.1 Rename `sendOrUpdateLiveMessage` → `updateLiveMessage` in `message-sender.ts` (method definition and all call sites in `kawa.ts`)
- [x] 2.2 Change `updateLiveMessage` return type from `Promise<ContactContext>` to `Promise<void>` in `message-sender.ts`
- [x] 2.3 Change `finalizeLiveMessage` return type from `Promise<ContactContext>` to `Promise<void>` in `message-sender.ts`

## 3. Collapse Trivial Indirection

- [x] 3.1 Remove the private `updateLiveMessage` wrapper method from `MessageSender` (the one that just extracts context fields and delegates to `updateLiveMessageCmd`)
- [x] 3.2 Update all call sites of the private wrapper to call `updateLiveMessageCmd` directly with explicit parameters (`contactId`, `liveMessageItemId!`, `accumulatedText`, `true`)

## 4. DRY Repetitive Casts

- [x] 4.1 Add `const DIRECT_CHAT_TYPE = ChatType.Direct as ChatType` at module top-level in `message-sender.ts`
- [x] 4.2 Replace all four occurrences of `ChatType.Direct as ChatType` with `DIRECT_CHAT_TYPE` in `message-sender.ts`

## 5. Co-locate Concerns

- [x] 5.1 Move `extractTextFromContent` from `kawa.ts` to `event-formatter.ts` (export it alongside sibling `extractMessageText`)
- [x] 5.2 Update the import in `kawa.ts` to reference `extractTextFromContent` from `event-formatter.ts` instead of locally

## 6. Remove Debris

- [x] 6.1 Delete orphaned file `flux/kawa/examples storytelling cats.txt`
- [x] 6.2 Delete orphaned file `flux/kawa/test/story.txt`
- [x] 6.3 Clean `.pi/sessions/` log clutter from the working directory

## 7. Verify

- [x] 7.1 Run `npm test` and confirm all unit tests pass
- [x] 7.2 Run TypeScript compilation (`tsc --noEmit`) and confirm no type errors introduced by return-type changes or renamed methods