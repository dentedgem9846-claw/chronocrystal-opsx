---
name: kawa-check
description: Run all checks for the kawa project after making code changes. Use after editing any file in flux/kawa/ to verify TypeScript compiles, Biome lint+format passes, and the build succeeds.
license: MIT
compatibility: Requires Node.js, TypeScript, Biome. Must be run from flux/kawa/.
metadata:
  author: kawa
  version: "2.0"
---

Run all quality checks for the kawa project. Always autofixes — never just reports.

**When to use**: After editing any file in `flux/kawa/` — source code, tests, or config. Run this before declaring a task done or proposing a change for archive.

**Steps**

1. Run:

```bash
cd flux/kawa && npm run check
```

This runs the full pipeline in one shot:
- `tsc --noEmit` — TypeScript type checking
- `biome check --write src/ tests/` — Biome lint + format with autofix
- `tsc` — Full TypeScript build to `dist/`

2. If any step fails, fix the errors and re-run. Do not proceed until `npm run check` passes clean.

3. If all checks pass, the change is ready for smoke testing or archiving.

**Common failures and fixes**:

- **TypeScript error**: Fix the type error in the indicated file and line. Re-run `npm run check`.
- **Biome lint/format error**: Already autofixed by `--write`. If autofix can't resolve it, fix manually and re-run.
- **Build error**: Usually a TypeScript compilation error — fix and re-run.

**Do NOT skip this step**. A change that doesn't pass `npm run check` is not done.