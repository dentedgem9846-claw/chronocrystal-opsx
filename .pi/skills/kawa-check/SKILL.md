---
name: kawa-check
description: Run all checks for the kawa project after making code changes. Use after editing any file in flux/kawa/ to verify TypeScript compiles, Biome lint/format passes, and the build succeeds.
license: MIT
compatibility: Requires Node.js, TypeScript, Biome. Must be run from flux/kawa/.
metadata:
  author: kawa
  version: "1.0"
---

Run all quality checks for the kawa project.

**When to use**: After editing any file in `flux/kawa/` — source code, tests, or config. Run this before declaring a task done or proposing a change for archive.

**Steps**

1. Run the combined check script:

```bash
cd flux/kawa && bash scripts/check.sh
```

This runs:
- `tsc --noEmit` — TypeScript type checking
- `biome check src/` — Biome lint+format for source
- `biome check tests/` — Biome lint+format for tests
- `npm run build` — Full TypeScript compilation

2. If any step fails, fix the errors and re-run. Do not proceed until all checks pass.

3. If all checks pass, the change is ready for smoke testing or archiving.

**Common failures and fixes**:

- **TypeScript error**: Fix the type error in the indicated file and line.
- **Biome lint error**: Run `npx biome check --fix src/` or `npx biome check --fix tests/` to auto-fix, then re-check.
- **Biome format error**: Run `npx biome check --fix --unsafe src/` for unsafe fixes, then re-check.
- **Build error**: Usually a TypeScript compilation error — fix the error and rebuild.

**Do NOT skip this step**. A change that doesn't pass all checks is not done.