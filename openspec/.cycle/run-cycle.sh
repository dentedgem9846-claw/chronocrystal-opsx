#!/usr/bin/env bash
# Run the opsx verify-applytest-explore cycle for a change
# Usage: bash run-cycle.sh <change-name>

set -euo pipefail

CHANGE_NAME="${1:?Usage: bash run-cycle.sh <change-name>}"
PROJECT_DIR="/home/exedev/chronocrystal"
KAWA_DIR="$PROJECT_DIR/flux/kawa"
CYCLE_DIR="$PROJECT_DIR/openspec/changes/$CHANGE_NAME/.cycle"
ORIGINAL="$CHANGE_NAME: create testing session with boxlite - e2e smoke tests for Kawa"

mkdir -p "$CYCLE_DIR"

# Helper: git commit
commit() {
  local phase="$1"
  local iteration="$2"
  cd "$KAWA_DIR"
  git add -A
  git commit -m "opsx: $phase $iteration for $CHANGE_NAME" --allow-empty 2>/dev/null || true
  cd "$PROJECT_DIR"
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
          # pi --skill takes a path to skill directory (containing SKILL.md) or file
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
MAX_ITERATIONS=3
STATE="verify"

while [ "$ITERATION" -le "$MAX_ITERATIONS" ]; do
  echo "=== Iteration $ITERATION — State: $STATE ==="

  case "$STATE" in
    verify)
      echo "Phase: VERIFY (GLM 5.1)"
      OUTPUT=$(run_agent "verify-glm" "ollama/glm-5.1:cloud" "read,grep,find,ls,bash" "Verify the change '$CHANGE_NAME' using the openspec-verify-change skill. Check specs, tasks, and design against actual code. Run kawa-check (check.sh). ORIGINAL: $ORIGINAL" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-verify.txt"

      if echo "$OUTPUT" | grep -q "ASSESSMENT: CLEAN"; then
        echo "VERIFY CLEAN — cycle complete!"
        commit "verify" "$ITERATION"
        STATE="COMPLETE"
        break
      else
        echo "VERIFY HAS_ISSUES — proceeding to apply+test"
        commit "verify" "$ITERATION"
        STATE="applytest"
      fi
      ;;

    applytest)
      echo "Phase: APPLY & TEST (Kimi K2.6)"
      # Get the last verify or explore output
      if [ -f "$CYCLE_DIR/${ITERATION}-verify.txt" ]; then
        PREV=$(cat "$CYCLE_DIR/${ITERATION}-verify.txt")
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
      if [ -f "$CYCLE_DIR/${ITERATION}-applytest.txt" ]; then
        PREV=$(cat "$CYCLE_DIR/${ITERATION}-applytest.txt")
      else
        PREV=$(cat "$CYCLE_DIR/${ITERATION}-applytest.txt" 2>/dev/null || echo "No previous output found")
      fi

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

echo ""
echo "=== Final state: $STATE ==="
echo "tmux session still running: tmux attach -t $SESSION"