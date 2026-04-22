---
name: openspec-triage-change
description: Triage verify output into code fixes, documentation updates, and scope increases. Use after verify finds issues to classify what needs code changes vs what needs docs vs what's a future change.
license: MIT
metadata:
  author: chronocrystal
  version: "1.0"
---

Classify verify issues into three buckets: CODE FIX (for apply+test), DOCUMENTATION (fix yourself), and SCOPE INCREASE (file for future).

**Input**: The verify agent's output containing CRITICAL, WARNING, and SUGGESTION issues. Also the change name to read artifacts for scope context.

**Steps**

1. **Read the change artifacts to understand scope**

   Read the change's proposal, specs, tasks, and design to understand what was originally requested. This is your scope boundary — the proposal defines what "in scope" means.

   ```bash
   openspec status --change "<name>" --json
   ```

   Then read:
   - `openspec/changes/<name>/proposal.md` — what the user asked for
   - `openspec/changes/<name>/tasks.md` — what was planned
   - `openspec/changes/<name>/design.md` — how it was designed
   - `openspec/changes/<name>/specs/*/spec.md` — what behavior is specified

2. **Read the verify output carefully**

   Parse every CRITICAL, WARNING, and SUGGESTION line from verify's output. Each one gets classified.

3. **Classify each issue**

   For each issue, ask: **"Would the original proposer agree this was always part of the scope?"**

   **CODE FIX** — Route to apply+test (Kimi fixes code):
   - Bug in existing implementation that contradicts spec or tasks
   - Missing test for a spec'd scenario (the spec says it should work, but there's no test)
   - Lint, type, or build errors in existing code
   - Code that doesn't match what tasks.md or specs require
   - Incomplete task where the implementation clearly should exist

   **DOCUMENTATION** — Fix yourself right now (no code changes):
   - Task numbering gaps (e.g., missing 4.2)
   - Inconsistencies between tasks.md and actual implementation
   - Design.md that's outdated vs current code
   - Proposal.md missing a capability the code now supports
   - Missing or stale comments in task checkboxes

   **SCOPE INCREASE** — File in issues.md for future consideration:
   - New feature not in the original proposal ("should add connection retry")
   - Architectural changes ("could share process pool across test suites")
   - "Would be nice" ideas that weren't requested
   - Missing spec for something that was never specified
   - Performance optimizations beyond original scope

4. **Fix documentation issues yourself**

   For every DOCUMENTATION issue, make the edit right now:
   - Update tasks.md if numbering is wrong or checkboxes are stale
   - Update design.md if it doesn't reflect the actual implementation
   - Update proposal.md if a capability was added but not documented

5. **File scope increases in issues.md**

   Create or append to `openspec/changes/<name>/issues.md` with each scope increase:

   ```markdown
   ## Issues

   - [ ] **[Title]** — [Description with enough detail for a future change request]
     Source: `path/to/file.ts:line`
     Scope: new feature | architectural change | missing spec | optimization
   ```

   Each issue must have:
   - A clear title
   - Enough description that someone can create a change request from it later
   - The source file/line where the gap was noticed
   - The scope category

6. **Produce triage output**

   List what you routed where and what you fixed yourself.

**Classification Heuristics**

- **When in doubt, file as SCOPE INCREASE** — it's always safe to let the human decide later
- **Missing test for spec'd behavior is CODE FIX** — the spec says it should work, the test gap is a bug
- **Missing test for unspecified behavior is SCOPE INCREASE** — no spec said it should work
- **A task marked incomplete could be CODE FIX or DOCUMENTATION**: if the code exists but the checkbox isn't checked, that's DOCUMENTATION; if the code doesn't exist, that's CODE FIX
- **"Should have X" where X isn't in proposal/specs is always SCOPE INCREASE**

**Output Format**

```
ROUTED TO KIMI:
CRITICAL: path/to/file.ts:42 — description (why it's in scope)
WARNING: path/to/file.ts:99 — description (why it's in scope)

DOCUMENTATION UPDATED:
- tasks.md: fixed task numbering gap (4.2)
- design.md: updated D3 to reflect POST /connect addition

FILED AS ISSUES (scope increase — not for this cycle):
ISSUE: Connection retry for POST /connect — kawa.ts:79 returns 500 on transport error with no retry mechanism
  Source: kawa.ts:79
  Scope: new feature
ISSUE: Shared process pool for e2e tests — 6 suites start/stop Kawa independently, ~15min total
  Source: tests/e2e/setup.ts:45
  Scope: architectural change

ASSESSMENT: HAS_CODE_FIXES | DOCS_ONLY | CLEAN
```

Three possible endings:
- `ASSESSMENT: HAS_CODE_FIXES` — there are code fixes to route to apply+test
- `ASSESSMENT: DOCS_ONLY` — documentation was updated, no code fixes needed, cycle can end
- `ASSESSMENT: CLEAN` — nothing to do, cycle can end