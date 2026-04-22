---
description: "Run the verify→apply+test→explore subagent cycle in tmux. Text-pipe handoffs, git commit between phases."
---

Run the **subagent-verify-applytest-explore** skill for a change, using tmux for monitoring.

**Input**: Optionally specify a change name after `/opsx-cycle`. If omitted, prompt for selection.

**Provided arguments**: $@

1. **Select change** — if no name given, ask the user.

2. **Create tmux session**: `tmux new-session -d -s opsx-<name> -c /home/exedev/chronocrystal && tmux split-window -h -t opsx-<name>`

3. **Phase 1: VERIFY** — Run in tmux pane 1:
   ```
   pi --agent verify-glm --no-session -p 'Verify change <name>'
   ```
   If `ASSESSMENT: CLEAN` → git commit, done.
   If `ASSESSMENT: HAS_ISSUES` → git commit, pipe output to phase 2.

4. **Phase 2: APPLY & TEST** — Run in tmux pane 1:
   ```
   echo '<verify output>' | pi --agent applytest-kimi --no-session -p 'Fix these issues and run tests for <name>. ORIGINAL: <user request>'
   ```
   If `ASSESSMENT: ALL_PASSED` → git commit, pipe to verify.
   If `ASSESSMENT: HAS_FAILURES` → git commit, pipe to explore.

5. **Phase 3: EXPLORE** — Run in tmux pane 1:
   ```
   echo '<applytest output>' | pi --agent explore-gemma --no-session -p 'Diagnose these failures for <name>. ORIGINAL: <user request>'
   ```
   If `NEXT: applytest` → git commit, pipe threads to apply+test.

6. **Loop**: Repeat until verify passes clean. Max 3 iterations.

7. **Complete**: Final git commit, kill tmux session: `tmux kill-session -t opsx-<name>`

**Handoff method**: Text piping — output of previous agent is `$INPUT` to next agent. `$ORIGINAL` (user's initial request) is carried through all phases. No JSON files.

**Git commit at every handoff**: `git add -A && git commit -m "opsx: <phase> <iteration> for <name>"` — no exceptions.

**Key rules**:
- Explore agent has NO write/edit tools — it literally cannot modify code
- Agent definitions: `.pi/agents/verify-glm.md`, `.pi/agents/applytest-kimi.md`, `.pi/agents/explore-gemma.md`
- Cycle definition: `openspec/.cycle/chain.yaml`
- Kawa runtime: `gemma4:31b-cloud` (constant, not switched)