## Issues

- [ ] **Unify extractTextFromContent implementations** — `file-receiver.ts` and `event-formatter.ts` both define an `extractTextFromContent` function with inconsistent fallback behavior (file-receiver returns `"📷 Image"` / `"🎥 Video"`, event-formatter returns `undefined`). Both functions serve different paths (file-attached vs plain messages), but the divergence is confusing and could lead to subtle bugs if code is reused or refactored. Consider extracting a single shared helper with configurable fallback behavior, or clearly documenting why the two implementations differ.
  - Source: `flux/kawa/src/file-receiver.ts:268`, `flux/kawa/src/event-formatter.ts:170`
  - Scope: architectural change
