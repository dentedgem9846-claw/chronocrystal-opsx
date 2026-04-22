---
name: kawa-clean
description: Clean up kawa processes and test artifacts. Use after smoke tests, after debugging sessions, or when kawa won't start because of stale processes or leftover temp directories.
license: MIT
compatibility: Requires bash. Must be run from a terminal on the host machine.
metadata:
  author: kawa
  version: "1.0"
---

Kill all running Kawa and simplex-chat processes and remove test artifacts.

**When to use**:
- After running smoke tests (to clean up残留 processes)
- When Kawa won't start because port 5225/8080 is already in use
- When `npm run smoke` fails because stale temp directories exist
- After a debugging session where Kawa was started manually
- Before running `npm run kawa:start` to ensure a clean state

**Steps**

1. Run the clean script:

```bash
cd flux/kawa && bash scripts/clean.sh
```

This kills:
- All `node dist/kawa.js` processes
- All `simplex-chat` processes

And removes these temp directories:
- `/tmp/kawa-e2e-simplex`
- `/tmp/alice-e2e-simplex`
- `/tmp/kawa-simplex`
- `/tmp/kawa-e2e-simplex-chat` (test wrapper)
- `/tmp/alice-e2e-simplex-chat` (test wrapper)

2. Or use npm:

```bash
cd flux/kawa && npm run clean
```

3. After cleaning, Kawa should start cleanly:

```bash
npm run kawa:start
```

**Symptoms that indicate you need this skill**:
- `Address already in use` error when starting Kawa
- `Port 5225 not available` error from simplex-chat
- Smoke tests failing to connect
- Stale `/tmp/kawa-*` directories from previous test runs