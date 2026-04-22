---
name: subagent-verify-applytest-explore
description: "Subagent cycle: verify (GLM), triage (Kimi classifies), apply+test (Kimi fixes), explore (Gemma diagnoses — no edits). Loops until verify passes clean. Git commit at every handoff."
license: MIT
metadata:
  author: chronocrystal
  version: "3.0"
---

Four-phase subagent cycle. Verify audits, triage classifies, apply+test fixes code, explore diagnoses failures. Loops until verify passes clean. Each phase runs as a `pi` subprocess in tmux. Handoff is text piping.

```
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  │
              ┌──────────┐                             │
       ┌─────►│  VERIFY   │──── CLEAN ────────▶ COMPLETE
       │      │  GLM 5.1 │         │
       │      └──────────┘         │ HAS_ISSUES
       │                           ▼
       │                    ┌──────────┐
       │                    │  TRIAGE   │──── DOCS_ONLY / CLEAN ────▶ COMPLETE
       │                    │  Kimi    │         │
       │                    └──────────┘         │ HAS_CODE_FIXES
       │                                         │
       │                                         ▼
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

Triage classifies every verify issue into three buckets:
- **CODE FIX** → Kimi (apply+test) fixes it
- **DOCUMENTATION** → Triage fixes docs itself (no code changes)
- **SCOPE INCREASE** → Filed in `issues.md` for future changes (not this cycle)

## Agent Definitions

| Phase | Agent File | Model | Tools | Skills |
|-------|-----------|-------|-------|--------|
| Verify | `.pi/agents/verify-glm.md` | glm-5.1:cloud | read,grep,find,ls,bash | openspec-verify-change, kawa-check |
| Triage | `.pi/agents/triage-kimi.md` | kimi-k2.6:cloud | read,write,edit,bash,grep,find,ls | openspec-verify-change |
| Apply & Test | `.pi/agents/applytest-kimi.md` | kimi-k2.6:cloud | read,write,edit,bash,grep,find,ls | openspec-apply-change, kawa-check, kawa-clean |
| Explore | `.pi/agents/explore-gemma.md` | gemma4:31b-cloud | read,grep,find,ls | openspec-explore |

Team: `verify-triage-applytest-explore` in `.pi/agents/teams.yaml`

## Handoff: Text Piping

Each agent receives:
- **$INPUT** — the text output from the previous phase
- **$ORIGINAL** — the user's initial request, carried unchanged through all phases

Each agent also receives its **skills** from the agent frontmatter — the cycle script extracts the `skills:` list and passes `--skill` flags to `pi`. The skills are the primary workflow knowledge.

Transition signals are parsed from each agent's output:
- Verify: `ASSESSMENT: CLEAN` or `ASSESSMENT: HAS_ISSUES`
- Triage: `ASSESSMENT: HAS_CODE_FIXES`, `ASSESSMENT: DOCS_ONLY`, or `ASSESSMENT: CLEAN`
- Apply & Test: `ASSESSMENT: ALL_PASSED` or `ASSESSMENT: HAS_FAILURES`
- Explore: `NEXT: applytest`

## Triage: The Classification Layer

Triage reads verify's output and the change's artifacts (proposal, specs, tasks, design) to decide:

| Bucket | What | Who handles |
|--------|------|-------------|
| CODE FIX | Bug, missing test for spec'd behavior, code doesn't match spec | Kimi (apply+test) |
| DOCUMENTATION | Task numbering gaps, outdated design.md, missing docs | Triage itself |
| SCOPE INCREASE | New feature, architectural change, "would be nice" ideas | Written to `issues.md` |

**Test for scope**: "Would the original proposer say 'I didn't ask for that'?" If yes → scope increase.

Scope increases go to `openspec/changes/<name>/issues.md` — a lightweight backlog the user can review and promote to full change requests later.

## Kawa Core Model

`gemma4:31b-cloud` — in `flux/kawa/.pi/settings.json`. Constant. Never switched.

## Git Commits at Every Handoff

Every phase **must** git commit before handing off. This creates a traceable history and allows rollback.

```bash
git add -A && git commit -m "opsx: <phase> <iteration> for <change-name>"
```

## Guardrails

- **Max 3 full iterations** (verify → triage → apply+test → explore = 1 iteration)
- **Anti-looping**: If verify and applytest alternate more than 3 times, force human intervention
- **Tool enforcement**: Explore agent has no `write` or `edit` tools
- **$ORIGINAL** carried through all phases to prevent context drift
- **Git commit at every handoff** — no exceptions

## Orchestration via Tmux

```
┌─────────────────────────────────────────────────────┐
│  tmux session: opsx-<change-name>                    │
│                                                       │
│  ┌────────────────┐  ┌────────────────────────────┐  │
│  │  orchestrator   │  │  active phase (pi subprocess) │  │
│  │  (left pane)    │  │  verify / triage / applytest  │  │
│  │                 │  │  explore                      │  │
│  └────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Cycle Definition

Declarative state machine in `openspec/.cycle/chain.yaml`.