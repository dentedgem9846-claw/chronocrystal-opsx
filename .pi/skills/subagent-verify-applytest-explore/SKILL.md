---
name: subagent-verify-applytest-explore
description: "Subagent cycle: verify (GLM), apply+test (Kimi implements), explore (Gemma diagnoses — no edits). Loops until verify passes clean. Git commit at every handoff."
license: MIT
metadata:
  author: chronocrystal
  version: "2.0"
---

Three-phase subagent cycle. Loops until VERIFY passes clean. Explore only diagnoses — Kimi implements. Each phase runs as a `pi` subprocess in tmux. Handoff is text piping — no JSON files.

```
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  │
              ┌──────────┐                             │
       ┌─────►│  VERIFY   │──── CLEAN ────────▶ COMPLETE
       │      │  GLM 5.1 │         │
       │      └──────────┘         │ HAS_ISSUES
       │                           ▼
       │                  ┌──────────────┐
       │                  │ APPLY & TEST  │◄──────────┐
       │                  │  Kimi k2.6    │             │
       │                  └──────┬───────┘             │
       │                         │                     │
       │                    ALL_PASSED?                │
       │                     │       │                  │
       │                  yes      HAS_FAILURES         │
       │                     │       │                  │
       │                     ▼  ┌───────────┐          │
       │              VERIFY     │  EXPLORE    │          │
       │                         │Gemma 4 31B │          │
       │                         └─────┬─────┘          │
       │                               │ threads          │
       │                               ▼                  │
       │                        Kimi implements ──────────┘
       │
       └── loop until verify passes clean (max 3 iterations)
```

## Agent Definitions

| Phase | Agent File | Model | Tools | Skills |
|-------|-----------|-------|-------|--------|
| Verify | `.pi/agents/verify-glm.md` | glm-5.1:cloud | read,grep,find,ls,bash | openspec-verify-change, kawa-check |
| Apply & Test | `.pi/agents/applytest-kimi.md` | kimi-k2.6:cloud | read,write,edit,bash,grep,find,ls | openspec-apply-change, kawa-check, kawa-clean |
| Explore | `.pi/agents/explore-gemma.md` | gemma4:31b-cloud | read,grep,find,ls | openspec-explore |

Team: `verify-applytest-explore` in `.pi/agents/teams.yaml`

## Handoff: Text Piping

Each agent receives two things:
- **$INPUT** — the text output from the previous phase
- **$ORIGINAL** — the user's initial request, carried unchanged through all phases

Each agent also receives its **skills** from the agent frontmatter — the cycle script extracts the `skills:` list and passes `--skill` flags to `pi`. The skills are the primary workflow knowledge:
- **Verify**: `openspec-verify-change` guides systematic completeness/correctness/coherence checks; `kawa-check` runs types, lint, and build
- **Apply & Test**: `openspec-apply-change` provides change context (specs, tasks, design); `kawa-check` for build/lint; `kawa-clean` for stuck processes
- **Explore**: `openspec-explore` orients diagnosis around the change's actual requirements

No JSON files. No structured handoff. Just text in, text out.

Transition signals are parsed from the last line of each agent's output:
- Verify ends with `ASSESSMENT: CLEAN` or `ASSESSMENT: HAS_ISSUES`
- Apply & Test ends with `ASSESSMENT: ALL_PASSED` or `ASSESSMENT: HAS_FAILURES`
- Explore ends with `NEXT: applytest`

## Kawa Core Model

`gemma4:31b-cloud` — in `flux/kawa/.pi/settings.json`. Constant. Never switched.

## Phase 1: VERIFY

**Agent**: `verify-glm` | **Model**: `glm-5.1:cloud` | **Tools**: read,grep,find,ls,bash | **Skills**: openspec-verify-change, kawa-check

```bash
pi --model glm-5.1:cloud --no-tools --tools read,grep,find,ls,bash \
  --no-extensions --no-session \
  --skill /path/to/.pi/skills/openspec-verify-change \
  --skill /path/to/.pi/skills/kawa-check \
  --append-system-prompt "$(cat .pi/agents/verify-glm.md)" \
  -p "Verify the change '$CHANGE_NAME' using openspec-verify-change. Run kawa-check." \
  --mode text
```

Output ends with `ASSESSMENT: CLEAN` → **git commit, cycle done**.
Output ends with `ASSESSMENT: HAS_ISSUES` → **git commit, pipe output to apply+test**.

## Phase 2: APPLY & TEST

**Agent**: `applytest-kimi` | **Model**: `kimi-k2.6:cloud` | **Tools**: read,write,edit,bash,grep,find,ls | **Skills**: openspec-apply-change, kawa-check, kawa-clean

```bash
pi --model kimi-k2.6:cloud --no-tools --tools read,write,edit,bash,grep,find,ls \
  --no-extensions --no-session \
  --skill /path/to/.pi/skills/openspec-apply-change \
  --skill /path/to/.pi/skills/kawa-check \
  --skill /path/to/.pi/skills/kawa-clean \
  --append-system-prompt "$(cat .pi/agents/applytest-kimi.md)" \
  -p "Fix these issues and run tests. Use openspec-apply-change for context. ORIGINAL: $ORIGINAL PREVIOUS: $INPUT" \
  --mode text
```

Output ends with `ASSESSMENT: ALL_PASSED` → **git commit, pipe output to verify**.
Output ends with `ASSESSMENT: HAS_FAILURES` → **git commit, pipe output to explore**.

## Phase 3: EXPLORE

**Agent**: `explore-gemma` | **Model**: `gemma4:31b-cloud` | **Tools**: read,grep,find,ls | **Skills**: openspec-explore

**This phase does NOT modify files.** It reads code and produces THREADs for Kimi.

```bash
pi --model gemma4:31b-cloud --no-tools --tools read,grep,find,ls \
  --no-extensions --no-session \
  --skill /path/to/.pi/skills/openspec-explore \
  --append-system-prompt "$(cat .pi/agents/explore-gemma.md)" \
  -p "Diagnose failures. Use openspec-explore for change context. ORIGINAL: $ORIGINAL PREVIOUS: $INPUT" \
  --mode text
```

Output ends with `NEXT: applytest` → **git commit, pipe threads to apply+test**.

## Git Commits at Every Handoff

Every phase **must** git commit before handing off. This creates a traceable history and allows rollback.

```bash
git add -A && git commit -m "opsx: <phase> <iteration> for <change-name>"
```

Example git log:
```
opsx: verify 1 for create-testing-session-with-boxlite
opsx: applytest 1 for create-testing-session-with-boxlite
opsx: explore 1 for create-testing-session-with-boxlite
opsx: applytest 2 for create-testing-session-with-boxlite
opsx: verify 2 for create-testing-session-with-boxlite
```

## Guardrails

- **Max 3 full iterations** (verify → apply+test → explore = 1 iteration)
- **Anti-looping**: If verify and apply+test alternate more than 3 times, force human intervention
- **Tool enforcement**: Explore agent has no `write` or `edit` tools
- **$ORIGINAL** carried through all phases to prevent context drift
- **Git commit at every handoff** — no exceptions

## Orchestration via Tmux

Each phase runs as a `pi` subprocess in tmux for real-time monitoring.

```
┌─────────────────────────────────────────────────────┐
│  tmux session: opsx-<change-name>                    │
│                                                       │
│  ┌────────────────┐  ┌────────────────────────────┐  │
│  │  orchestrator   │  │  active phase (pi subprocess) │  │
│  │  (left pane)    │  │  verify-glm / applytest-kimi │  │
│  │                 │  │  explore-gemma                │  │
│  └────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- **Pane 0 (left)**: Orchestrator
- **Pane 1 (right)**: Active `pi --agent <name> --no-session` subprocess

```bash
# Create session
tmux new-session -d -s opsx-<change-name> -c /home/exedev/chronocrystal

# Run phase in pane 1
tmux send-keys -t opsx-<name>:0.1 "..." Enter

# Attach to watch
tmux attach -t opsx-<change-name>
```

## Cycle definition

Declarative state machine in `openspec/.cycle/chain.yaml` — states, transitions, models, tools, and guardrails.