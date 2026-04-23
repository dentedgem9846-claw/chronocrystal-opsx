---
name: cycle-verify
description: Run the opsx verify→triage→apply+test→explore cycle for a change until the verifier passes clean. Use after implementation is complete to confirm everything checks out before archiving.
license: MIT
compatibility: Requires pi, ollama with GLM/Kimi/Gemma models, tmux. Must be run from project root.
metadata:
  author: chronocrystal
  version: "1.0"
---

Run the opsx verify cycle for a change until the verifier reports CLEAN.

**When to use**: After implementation is complete and `npm run check` passes. This is the final validation step before archiving a change.

**Steps**

1. **Commit any uncommitted work first.** Stage changed files explicitly by name (never `git add -A`), then commit. The cycle needs a clean working tree to start.

2. **Clean previous cycle artifacts** (if re-running):

```bash
rm -rf openspec/changes/<change-name>/.cycle/*
tmux kill-session -t opsx-<change-name> 2>/dev/null
```

3. **Run the cycle:**

```bash
bash openspec/.cycle/run-cycle.sh <change-name>
```

Replace `<change-name>` with the directory name under `openspec/changes/` (e.g. `throttle-live-message-updates`).

4. **Monitor progress.** The cycle runs in a tmux session `opsx-<change-name>`. You can watch:

```bash
tmux attach -t opsx-<change-name>
```

5. **Interpret the result.** The cycle ends in one of two states:
   - `COMPLETE` — verify passed CLEAN. Ready to archive.
   - `MAX ITERATIONS REACHED` — human intervention needed. Check cycle output files in `openspec/changes/<change-name>/.cycle/` and `issues.md`.

6. **If the cycle timed out** (bash timeout), check whether the agent made code changes:

```bash
git status
```

Commit any changes, verify they compile (`cd flux/kawa && npm run check && npm run test`), then re-run the cycle so verify can see the fixes.

7. **After CLEAN, archive** using the `openspec-archive-change` skill.

**What the cycle does**

| Phase | Model | Purpose |
|-------|-------|---------|
| verify | GLM 5.1 | Audits specs, tasks, and code. Runs kawa-check. |
| triage | Kimi K2.6 | Classifies issues: code fixes → Kimi, docs → self, scope increases → issues.md |
| apply+test | Kimi K2.6 | Applies fixes, runs smoke tests |
| explore | Gemma 4 31B | Diagnoses failures (read-only, no edits) |

The cycle loops through these phases until verify reports `ASSESSMENT: CLEAN` or 5 iterations are exhausted.

**Important rules**
- Never commit with `git add -A` — always stage files by name
- The cycle script's `commit()` function only stages known change artifacts (`flux/kawa/src/`, `flux/kawa/tests/`, `openspec/changes/<name>/`, `AGENTS.md`)
- If you need to interrupt, kill the tmux session: `tmux kill-session -t opsx-<change-name>`