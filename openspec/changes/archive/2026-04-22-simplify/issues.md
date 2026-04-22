# Backlog Issues — Simplify Change

## ISSUE-001: Add unit tests for MessageSender
Add lightweight unit tests for `MessageSender` methods covering the spec's key scenarios:
- `updateLiveMessage` skips calling `updateLiveMessageCmd` when `liveMessageItemId` is null
- `finalizeLiveMessage` skips calling `updateLiveMessageCmd` when `liveMessageItemId` is null
- `startLiveMessage` returns null when `sendChatCmd` fails or returns no items
- `sendTextMessage` error handling (console.error path)

Currently `flux/kawa/tests/` contains only e2e tests. The `npm test` script (`vitest run --exclude tests/e2e`) exits with "No test files found".

**Source:** `flux/kawa/tests/` contains only `e2e/`
**Scope:** missing spec / new feature

## ISSUE-002: Enforce MessageSender API boundary by making `updateLiveMessageCmd` private
`updateLiveMessageCmd` currently has no access modifier (defaults to public). Since the intended caller-facing API is `updateLiveMessage` (which provides a null guard for `liveMessageItemId`), consider marking `updateLiveMessageCmd` as `private` to prevent external callers from bypassing the guard.

This is a one-line change but constitutes an API-surface reduction. Verify no external callers exist first (confirmed: none in `kawa.ts` or elsewhere).

**Source:** `message-sender.ts:82`
**Scope:** architectural change
