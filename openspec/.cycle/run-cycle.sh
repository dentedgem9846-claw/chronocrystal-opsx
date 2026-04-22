#!/usr/bin/env bash
# Run the opsx verify → triage → apply+test → explore cycle for a change
# Usage: bash run-cycle.sh <change-name>
#
# The cycle runs until verify reports CLEAN — all issues must be addressed either
# by fixing them in code/docs or by filing them as scope increases in issues.md.
# No phase may declare the cycle complete except verify with ASSESSMENT: CLEAN.

set -euo pipefail

CHANGE_NAME="${1:?Usage: bash run-cycle.sh <change-name>}"
PROJECT_DIR="/home/exedev/chronocrystal"
KAWA_DIR="$PROJECT_DIR/flux/kawa"
CYCLE_DIR="$PROJECT_DIR/openspec/changes/$CHANGE_NAME/.cycle"

# Derive ORIGINAL from the change proposal (first line of proposal.md)
ORIGINAL=$(head -3 "$PROJECT_DIR/openspec/changes/$CHANGE_NAME/proposal.md" 2>/dev/null | tr '\n' ' ' || echo "$CHANGE_NAME")

# Clean previous cycle artifacts
rm -rf "$CYCLE_DIR"/*
mkdir -p "$CYCLE_DIR"

# Helper: git commit
commit() {
  local phase="$1"
  local iteration="$2"
  cd "$PROJECT_DIR"
  git add -A
  git commit -m "opsx: $phase $iteration for $CHANGE_NAME" --allow-empty 2>/dev/null || true
}

# Helper: run pi agent
# Skills are defined in the agent frontmatter;
# --skill flags are built from the agent's skills: field.
run_agent() {
  local agent_file="$1"
  local model="$2"
  local tools="$3"
  local prompt="$4"

  local agent_path="$PROJECT_DIR/.pi/agents/$agent_file.md"

  # Extract skills from agent frontmatter (yaml between --- markers)
  local skill_flags=""
  local in_frontmatter=false
  local in_skills=false
  while IFS= read -r line; do
    if [[ "$line" == "---" ]]; then
      if $in_frontmatter; then
        break
      else
        in_frontmatter=true
        continue
      fi
    fi
    if $in_frontmatter; then
      if [[ "$line" =~ ^skills: ]]; then
        in_skills=true
        continue
      fi
      if $in_skills; then
        if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
          local skill_name="${BASH_REMATCH[1]}"
          skill_flags="$skill_flags --skill $PROJECT_DIR/.pi/skills/$skill_name"
        elif [[ ! "$line" =~ ^[[:space:]] ]]; then
          in_skills=false
        fi
      fi
    fi
  done < "$agent_path"

  pi \
    --model "$model" \
    --no-tools --tools "$tools" \
    --no-extensions \
    --no-session \
    $skill_flags \
    --append-system-prompt "$(cat "$agent_path")" \
    -p "$prompt" \
    --mode text
}

SESSION="opsx-$CHANGE_NAME"

# Create tmux session
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR"
tmux split-window -h -t "$SESSION" -c "$PROJECT_DIR"

echo "=== OPSX Cycle: $CHANGE_NAME ==="
echo "tmux session: $SESSION"
echo "Monitor with: tmux attach -t $SESSION"
echo ""

ITERATION=1
MAX_ITERATIONS=5
STATE="verify"
PREV_VERIFY=""
PREV_TRIAGE=""

while [ "$ITERATION" -le "$MAX_ITERATIONS" ]; do
  echo "=== Iteration $ITERATION — State: $STATE ==="

  case "$STATE" in
    verify)
      echo "Phase: VERIFY (GLM 5.1)"
      # Build focused prompt: if re-verifying, tell the agent what to re-check
      if [ -n "$PREV_VERIFY" ]; then
        VERIFY_PROMPT="Re-verify the change '$CHANGE_NAME' using the openspec-verify-change skill. Focus on confirming whether the issues from the previous verification have been addressed (by fixes or by filing in issues.md). Run kawa-check (npm run check). PREVIOUS ISSUES: $PREV_VERIFY ORIGINAL: $ORIGINAL"
      else
        VERIFY_PROMPT="Verify the change '$CHANGE_NAME' using the openspec-verify-change skill. Check specs, tasks, and design against actual code. Run kawa-check (npm run check). ORIGINAL: $ORIGINAL"
      fi
      OUTPUT=$(run_agent "verify-glm" "ollama/glm-5.1:cloud" "read,grep,find,ls,bash" "$VERIFY_PROMPT" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-verify.txt"
      # Carry forward for next iteration
      PREV_VERIFY=$(echo "$OUTPUT" | grep -E '^(CRITICAL|WARNING|W[0-9]+)' | head -20)

      if echo "$OUTPUT" | grep -q "ASSESSMENT: CLEAN"; then
        echo "VERIFY CLEAN — cycle complete!"
        commit "verify" "$ITERATION"
        STATE="COMPLETE"
        break
      else
        echo "VERIFY HAS_ISSUES — proceeding to triage"
        commit "verify" "$ITERATION"
        STATE="triage"
      fi
      ;;

    triage)
      echo "Phase: TRIAGE (Kimi K2.6)"
      PREV=$(cat "$CYCLE_DIR/${ITERATION}-verify.txt")
      # Tell triage which issues were already filed so it doesn't re-classify them
      ISSUES_CONTEXT=""
      if [ -f "$PROJECT_DIR/openspec/changes/$CHANGE_NAME/issues.md" ]; then
        ISSUES_CONTEXT="Already filed in issues.md (do not re-file these): $(cat "$PROJECT_DIR/openspec/changes/$CHANGE_NAME/issues.md")"
      fi

      OUTPUT=$(run_agent "triage-kimi" "ollama/kimi-k2.6:cloud" "read,write,edit,bash,grep,find,ls" "Classify the verification issues below. Fix docs yourself, route code fixes to Kimi, file scope increases in issues.md. Use openspec-verify-change for change context. $ISSUES_CONTEXT ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-triage.txt"

      if echo "$OUTPUT" | grep -q "ASSESSMENT: HAS_CODE_FIXES"; then
        echo "TRIAGE found code fixes — proceeding to apply+test"
        commit "triage" "$ITERATION"
        STATE="applytest"
      elif echo "$OUTPUT" | grep -q "ASSESSMENT: DOCS_ONLY"; then
        echo "TRIAGE fixed docs only — looping back to verify"
        commit "triage" "$ITERATION"
        STATE="verify"
        ITERATION=$((ITERATION + 1))
      else
        echo "TRIAGE found nothing to fix — looping back to verify"
        commit "triage" "$ITERATION"
        STATE="verify"
        ITERATION=$((ITERATION + 1))
      fi
      ;;

    applytest)
      echo "Phase: APPLY & TEST (Kimi K2.6)"
      # Get the last triage or explore output
      if [ -f "$CYCLE_DIR/${ITERATION}-triage.txt" ]; then
        PREV=$(cat "$CYCLE_DIR/${ITERATION}-triage.txt")
      elif [ -f "$CYCLE_DIR/${ITERATION}-explore.txt" ]; then
        PREV=$(cat "$CYCLE_DIR/${ITERATION}-explore.txt")
      else
        PREV=$(cat "$CYCLE_DIR/$((ITERATION-1))-explore.txt" 2>/dev/null || echo "No previous output found")
      fi

      OUTPUT=$(run_agent "applytest-kimi" "ollama/kimi-k2.6:cloud" "read,write,edit,bash,grep,find,ls" "Fix the issues listed below and run the smoke tests. Use openspec-apply-change to get change context first. ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-applytest.txt"

      if echo "$OUTPUT" | grep -q "ASSESSMENT: ALL_PASSED"; then
        echo "ALL TESTS PASSED — proceeding to verify"
        commit "applytest" "$ITERATION"
        STATE="verify"
        ITERATION=$((ITERATION + 1))
      else
        echo "HAS FAILURES — proceeding to explore"
        commit "applytest" "$ITERATION"
        STATE="explore"
      fi
      ;;

    explore)
      echo "Phase: EXPLORE (Gemma 4 31B)"
      PREV=$(cat "$CYCLE_DIR/${ITERATION}-applytest.txt" 2>/dev/null || echo "No previous output found")

      OUTPUT=$(run_agent "explore-gemma" "ollama/gemma4:31b-cloud" "read,grep,find,ls" "Diagnose the test failures listed below. Use the openspec-explore skill to get oriented on the change. Suggest threads for Kimi to fix. Do NOT modify any files. ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-explore.txt"

      echo "EXPLORE done — proceeding to apply+test"
      commit "explore" "$ITERATION"
      STATE="applytest"
      ;;
  esac
done

if [ "$STATE" != "COMPLETE" ]; then
  echo "=== MAX ITERATIONS REACHED — human intervention needed ==="
fi

echo ""
echo "=== Cycle output files ==="
ls -la "$CYCLE_DIR/"

# Show issues.md if it was created
if [ -f "$PROJECT_DIR/openspec/changes/$CHANGE_NAME/issues.md" ]; then
  echo ""
  echo "=== Issues filed (scope increases) ==="
  cat "$PROJECT_DIR/openspec/changes/$CHANGE_NAME/issues.md"
fi

echo ""
echo "=== Final state: $STATE ==="
echo "tmux session still running: tmux attach -t $SESSION"