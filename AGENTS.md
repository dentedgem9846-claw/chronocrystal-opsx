# Chronocrystal — Coding Agent Rules

Rules that catch real bugs before they ship. Every rule here exists because we shipped a bug that it would have caught.

## 0. Available scripts and skills

### Scripts (`cd flux/kawa`)

```bash
npm run build        # TypeScript compilation to dist/
npm run check        # tsc type check + biome autfix (lint+format) + tsc build
npm run smoke        # e2e smoke tests
npm run clean        # kill kawa/simplex processes, remove /tmp dirs
npm run start:kawa   # start kawa, wait for address
npm run stop:kawa    # stop kawa
```

### Automatic skills

- **`/kawa-check`** — Run after any file edit in `flux/kawa/`. Runs `npm run check` (tsc, biome autofix, build). Fails the task if checks don't pass.
- **`/kawa-clean`** — Run when Kawa won't start, ports are stuck, or after smoke tests. Kills processes and removes `/tmp/kawa-*` dirs.

## 1. Run the checks after every change

Every subproject has a build and lint step. Run them before calling a task done.

```bash
cd flux/kawa
npm run check   # tsc type check + biome autofix (lint+format) + tsc build
```

`npm run check` runs the full pipeline: type check, biome lint+format with autofix, then build. One command, everything fixed. If it fails, the change is not done.

## 2. Side-effect order matters — read the task carefully

When a task says "do A **before** B", the implementation must do A before B. Watch out for helper functions that perform B as a hidden side effect (e.g., `removeByContactId` calling `unsubscribe` internally). Extract the values you need first, do A, then do B, then clean up.

**Check**: If a task describes an ordering constraint, trace every function call in your implementation to confirm no hidden reordering happens.

## 3. "Finalize" means the external side effect, not just local state

When a task says "finalize a live message" or "clean up a resource", it means calling the API/system that makes the change visible externally (e.g., sending `liveMessage: false` to SimpleX, deleting a file on disk, closing a network connection). Setting a local variable to `IDLE` is not finalization if the external system still sees `STREAMING`.

**Check**: After implementing "finalize/close/clean up X", verify the external system reflects the change — not just the in-memory state.

## 4. Every task needs a grep before marking done

Before checking a task box, search the codebase for the implementation:

```bash
grep -rn "keywordFromTask" src/ tests/
```

If the implementation doesn't exist, the task is not done. A task description is a requirement, not a suggestion.

## 5. Test assertions must match spec scenarios, not just "something happened"

If a spec scenario says "the response contains X", the assertion must check for X — not just `expect(reply.length).toBeGreaterThan(0)`. Weak assertions pass on bugs.

**Check**: Read each spec scenario. For each assertion in the test, ask: "Would this assertion catch a bug where the spec requirement is violated?" If the answer is no, tighten the assertion.

For LLM non-determinism, use regex matchers or substring checks — never just length checks.

## 6. Setup and teardown must be symmetrical

Every resource created in `beforeAll`/`setUp` must be cleaned up in `afterAll`/`tearDown`. This includes:
- Child processes → kill
- Temp directories → `rmSync`
- Wrapper scripts → `rmSync`
- Network connections → `disconnect()`

**Check**: Read teardown. For every `spawn`, `mkdirSync`, `writeFileSync`, or `create` in setup, verify a corresponding cleanup call exists.

## 7. Fail loudly on missing prerequisites, don't skip silently

If a test suite requires external tools (e.g., `simplex-chat`, `ollama`), check for them at the top of setup and throw a descriptive error naming exactly what's missing and how to install it. Silent skips mean the test never runs and the bug ships undetected.

```typescript
function checkPrerequisites(): void {
  const missing: string[] = [];
  try { execSync("command --version", { stdio: "pipe" }); } catch {
    missing.push("command not found. Install it: https://...");
  }
  if (missing.length > 0) throw new Error(`Prerequisites missing:\n${missing.join("\n")}`);
}
```

## 8. Don't use `any` — narrow the type instead

```typescript
// Wrong
aliceClient = null as any;

// Right
let aliceClient: ChatClient | null = null;
aliceClient = null;
```

Linters flag `any` for a reason. Fix the type, don't suppress the warning.

## 9. Stage files explicitly, never `git add -A`

`git add -A` (or `git add --all` or `git add .`) stages everything — including stray temp files, cycle artifacts, editor leftovers, and anything else lying in the working tree. These unintended files enter version history permanently and can't be removed without a force push.

Always stage files by name so every change is intentional and reviewable:

```bash
# Wrong
git add -A
git add .
git add --all

# Right
git add src/live-message-throttler.ts src/session-manager.ts AGENTS.md
```

**Check**: Before every commit, run `git diff --cached --stat` and read the file list. If a file is there that you didn't intend to change, unstage it (`git reset HEAD <file>`) and re-evaluate.

## 10. E2E tests treat the system under test as a black box

Tests configure Kawa through environment variables and its HTTP address API only. No wrapper scripts, no patching internal binaries, no reaching into Kawa's subprocess management. If the test needs to configure Kawa's simplex-chat data directory or bot display name, that's Kawa's config surface (`KAWA_SIMPLEX_DATA_DIR`, `KAWA_BOT_DISPLAY_NAME`) — add it to `KawaConfig`, not a shell script wrapper.

Alice (the test client) is NOT the system under test — wrapper scripts for Alice are fine.

**Check**: If setup.ts creates a wrapper script that wraps Kawa's binary, the test is white-box. Move that config into KawaConfig as an env var.

## 11. Don't assume — ask, surface ambiguity, push back

When a task is ambiguous, don't pick an interpretation silently and run with it. State your assumptions. If two readings exist, present both. If a simpler approach solves the problem, say so. If something is unclear, stop and ask.

LLMs silently pick the more complicated interpretation and implement 200 lines when 50 would do. Naming what's unclear prevents rewrites.

**Check**: Before implementing, list what the task could mean. If you picked the complex one, justify why. If you can't, ask.

## 12. Minimum code that solves the problem — nothing speculative

No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If 200 lines could be 50, rewrite it.

Would a senior engineer say this is overcomplicated? If yes, simplify.

**Check**: Read your diff. Every added line should trace directly to the user's request. If it doesn't, remove it. Mention unrelated dead code you notice — don't delete it.

## 13. Touch only what you must — clean up only your own mess

Don't "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style, even if you'd do it differently. When your changes create orphans (unused imports, variables, functions), remove only the ones YOUR changes made unused — not pre-existing dead code.

**Check**: Every changed line in your diff should trace directly to what was requested. If a line doesn't, revert it.

## 14. Define success criteria — loop until verified

Transform imperative tasks into verifiable goals:

| Instead of... | Transform to... |
|---|---|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state the plan with verification points:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**Check**: Before starting a task, write down what "done" looks like as a testable condition. After implementing, verify each condition.