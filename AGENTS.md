# Chronocrystal — Coding Agent Rules

Rules that catch real bugs before they ship. Every rule here exists because we shipped a bug that it would have caught.

## 0. Available scripts and skills

### Scripts (`cd flux/kawa`)

```bash
npm run build        # TypeScript compilation
npm run check        # Biome lint+format for src/
npm run check:all    # tsc + Biome for src/ and tests/
npm run smoke        # e2e smoke tests
npm run clean        # kill processes, remove temp dirs
npm run kawa:start   # start kawa, print address
npm run kawa:stop    # stop kawa
```

Or directly:

```bash
bash scripts/clean.sh    # kill all kawa/simplex processes + remove /tmp dirs
bash scripts/check.sh    # tsc + biome + build
bash scripts/start.sh    # start kawa, wait for address
bash scripts/stop.sh     # stop kawa
```

### Automatic skills

- **`/kawa-check`** — Run after any file edit in `flux/kawa/`. Runs `scripts/check.sh` (tsc, biome, build). Fails the task if checks don't pass.
- **`/kawa-clean`** — Run when Kawa won't start, ports are stuck, or after smoke tests. Kills processes and removes `/tmp/kawa-*` dirs.

## 1. Run the checks after every change

Every subproject has a build and lint step. Run them before calling a task done.

```bash
cd flux/<project>
npm run build   # TypeScript compilation
npm run check   # Biome lint + format (or whatever the project uses)
npx biome check tests/ src/   # If tests/ aren't in the default check path
```

If any fail, the change is not done.

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

## 9. E2E tests treat the system under test as a black box

Tests configure Kawa through environment variables and its HTTP address API only. No wrapper scripts, no patching internal binaries, no reaching into Kawa's subprocess management. If the test needs to configure Kawa's simplex-chat data directory or bot display name, that's Kawa's config surface (`KAWA_SIMPLEX_DATA_DIR`, `KAWA_BOT_DISPLAY_NAME`) — add it to `KawaConfig`, not a shell script wrapper.

Alice (the test client) is NOT the system under test — wrapper scripts for Alice are fine.

**Check**: If setup.ts creates a wrapper script that wraps Kawa's binary, the test is white-box. Move that config into KawaConfig as an env var.