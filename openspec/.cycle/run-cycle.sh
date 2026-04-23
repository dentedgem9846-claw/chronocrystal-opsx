#!/usr/bin/env bash
# Run the opsx verify → triage → apply+test → explore cycle for a change
# Usage: bash run-cycle.sh <change-name>
#
# The cycle runs until verify reports CLEAN — all issues must be addressed either
# by fixing them in code/docs or by filing them as scope increases in issues.md.
# No phase may declare the cycle complete except verify with ASSESSMENT: CLEAN.

set -uo pipefail

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

# Helper: detect assessment from agent output
# Checks for exact markers first, then falls back to fuzzy detection
detect_assessment() {
  local output="$1"
  local marker="$2"
  # Exact match (case-sensitive)
  if echo "$output" | grep -q "$marker"; then
    return 0
  fi
  # Case-insensitive match
  if echo "$output" | grep -qi "$(echo "$marker" | sed 's/:/:/')"; then
    return 0
  fi
  # Fuzzy: look for the assessment word near "assessment" or "final assessment"
  local keyword
  keyword=$(echo "$marker" | sed 's/ASSESSMENT: //')
  case "$keyword" in
    CLEAN)
      # Look for phrases indicating clean/no issues
      if echo "$output" | grep -qiE "(no (critical|issue|problem)|all (task|check|test).*(complete|pass|green)|cycle complete|ready for archive|verification complete)"; then
        return 0
      fi
      ;;
    HAS_ISSUES|HAS_CODE_FIXES)
      # Look for phrases indicating issues found
      if echo "$output" | grep -qiE "(critical|warning|issue found|bug|missing|inconsisten|divergen|fail)"; then
        return 0
      fi
      ;;
    DOCS_ONLY)
      if echo "$output" | grep -qiE "(doc(umentation)? only|spec (typo|fix|update)|no code)"; then
        return 0
      fi
      ;;
    ALL_PASSED)
      if echo "$output" | grep -qiE "(all (test|check|smoke).*(pass|green|success)|0 (fail|error))"; then
        return 0
      fi
      ;;
    HAS_FAILURES)
      if echo "$output" | grep -qiE "(test.*(fail|error|broken)|smoke.*(fail|error))"; then
        return 0
      fi
      ;;
  esac
  return 1
}

# Helper: extract issue summary from verify output for next iteration prompt
extract_issues() {
  local output="$1"
  # Try structured format first
  local structured
  structured=$(echo "$output" | grep -E '^(CRITICAL|WARNING|SUGGESTION)[: ]' | head -20) || true
  if [ -n "$structured" ]; then
    echo "$structured"
    return
  fi
  # Try markdown headers
  local headers
  headers=$(echo "$output" | grep -E '^(#+\s*)?(CRITICAL|WARNING|SUGGESTION)' | head -20) || true
  if [ -n "$headers" ]; then
    echo "$headers"
    return
  fi
  # Fallback: extract the "Issues by Priority" section
  local section
  section=$(echo "$output" | sed -n '/##.*Issue.*Priority/,/^##\|^$/p' | head -30) || true
  if [ -n "$section" ]; then
    echo "$section"
    return
  fi
  # Last resort: grab last 500 chars
  echo "$output" | tail -c 500
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

# Format enforcement appendix — appended to every agent prompt
FORMAT_REMINDER='

=== OUTPUT FORMAT — MANDATORY ===
You MUST end your response with exactly one of these assessment lines on its own line:
- ASSESSMENT: CLEAN
- ASSESSMENT: HAS_ISSUES
(for triage, also: ASSESSMENT: HAS_CODE_FIXES, ASSESSMENT: DOCS_ONLY)
(for apply+test, also: ASSESSMENT: ALL_PASSED, ASSESSMENT: HAS_FAILURES)

If you find any CRITICAL or WARNING issues, use ASSESSMENT: HAS_ISSUES (not CLEAN).
If everything passes with no issues, use ASSESSMENT: CLEAN.

Format each issue as a line starting with the priority:
CRITICAL: file:line — description
WARNING: file:line — description
SUGGESTION: description

Do NOT use markdown headers for issues. Use the line-prefix format above.
=== END FORMAT ==='

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
NEEDS_FULL_REVERIFY=false

while [ "$ITERATION" -le "$MAX_ITERATIONS" ]; do
  echo "=== Iteration $ITERATION — State: $STATE ==="

  case "$STATE" in
    verify)
      echo "Phase: VERIFY (GLM 5.1)"
      # Build focused prompt: if re-verifying, tell the agent what to re-check
      IS_FOCUSED_VERIFY=false
      if [ "$NEEDS_FULL_REVERIFY" = true ]; then
        VERIFY_PROMPT="FULL RE-VERIFICATION of change '$CHANGE_NAME' using the openspec-verify-change skill. A focused re-verify reported CLEAN — now do a complete scan to catch any issues introduced by fixes. Check specs, tasks, and design against actual code. Run kawa-check (npm run check). ORIGINAL: $ORIGINAL"
        NEEDS_FULL_REVERIFY=false
      elif [ -n "$PREV_VERIFY" ]; then
        VERIFY_PROMPT="Re-verify the change '$CHANGE_NAME' using the openspec-verify-change skill. Focus on confirming whether the issues from the previous verification have been addressed (by fixes or by filing in issues.md). Run kawa-check (npm run check). PREVIOUS ISSUES: $PREV_VERIFY ORIGINAL: $ORIGINAL"
        IS_FOCUSED_VERIFY=true
      else
        VERIFY_PROMPT="Verify the change '$CHANGE_NAME' using the openspec-verify-change skill. Check specs, tasks, and design against actual code. Run kawa-check (npm run check). ORIGINAL: $ORIGINAL"
      fi
      VERIFY_PROMPT="${VERIFY_PROMPT}${FORMAT_REMINDER}"
      OUTPUT=$(run_agent "verify-glm" "ollama/glm-5.1:cloud" "read,grep,find,ls,bash" "$VERIFY_PROMPT" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-verify.txt"
      # Carry forward for next iteration
      PREV_VERIFY=$(extract_issues "$OUTPUT")

      if detect_assessment "$OUTPUT" "ASSESSMENT: CLEAN"; then
        if [ "$IS_FOCUSED_VERIFY" = true ]; then
          # Focused re-verify came back clean — schedule one final full scan
          echo "VERIFY CLEAN (focused) — scheduling final full re-verification"
          NEEDS_FULL_REVERIFY=true
          commit "verify" "$ITERATION"
          ITERATION=$((ITERATION + 1))
          STATE="verify"
        else
          # Full scan (first or final) came back clean — done
          echo "VERIFY CLEAN (full scan) — cycle complete!"
          commit "verify" "$ITERATION"
          STATE="COMPLETE"
          break
        fi
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

      TRIAGE_PROMPT="Classify the verification issues below. Fix docs yourself, route code fixes to Kimi, file scope increases in issues.md. Use openspec-verify-change for change context. $ISSUES_CONTEXT ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV${FORMAT_REMINDER}"
      OUTPUT=$(run_agent "triage-kimi" "ollama/kimi-k2.6:cloud" "read,write,edit,bash,grep,find,ls" "$TRIAGE_PROMPT" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-triage.txt"

      if detect_assessment "$OUTPUT" "ASSESSMENT: HAS_CODE_FIXES"; then
        echo "TRIAGE found code fixes — proceeding to apply+test"
        commit "triage" "$ITERATION"
        STATE="applytest"
      elif detect_assessment "$OUTPUT" "ASSESSMENT: DOCS_ONLY"; then
        echo "TRIAGE fixed docs only — looping back to verify"
        commit "triage" "$ITERATION"
        STATE="verify"
        ITERATION=$((ITERATION + 1))
      elif detect_assessment "$OUTPUT" "ASSESSMENT: CLEAN"; then
        echo "TRIAGE found nothing to fix — cycle complete"
        commit "triage" "$ITERATION"
        STATE="COMPLETE"
        break
      else
        # No assessment marker found — default to HAS_CODE_FIXES if any issues were mentioned
        echo "TRIAGE — no clear assessment marker, checking for issues..."
        if echo "$OUTPUT" | grep -qiE "(CRITICAL|WARNING|fix|bug|missing|inconsisten)"; then
          echo "TRIAGE found mentioned issues — proceeding to apply+test"
          commit "triage" "$ITERATION"
          STATE="applytest"
        else
          echo "TRIAGE found nothing actionable — looping back to verify"
          commit "triage" "$ITERATION"
          STATE="verify"
          ITERATION=$((ITERATION + 1))
        fi
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

      APPLY_PROMPT="Fix the issues listed below and run the smoke tests. Use openspec-apply-change to get change context first. ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV${FORMAT_REMINDER}"
      OUTPUT=$(run_agent "applytest-kimi" "ollama/kimi-k2.6:cloud" "read,write,edit,bash,grep,find,ls" "$APPLY_PROMPT" 2>&1)
      echo "$OUTPUT"
      echo "$OUTPUT" > "$CYCLE_DIR/${ITERATION}-applytest.txt"

      if detect_assessment "$OUTPUT" "ASSESSMENT: ALL_PASSED"; then
        echo "ALL TESTS PASSED — proceeding to verify"
        commit "applytest" "$ITERATION"
        STATE="verify"
        ITERATION=$((ITERATION + 1))
      elif detect_assessment "$OUTPUT" "ASSESSMENT: HAS_FAILURES"; then
        echo "HAS FAILURES — proceeding to explore"
        commit "applytest" "$ITERATION"
        STATE="explore"
      else
        # No assessment marker — check for pass/fail indicators
        echo "APPLY & TEST — no clear assessment marker, checking results..."
        if echo "$OUTPUT" | grep -qiE "(test.*(fail|error|broken)|smoke.*fail)"; then
          echo "HAS FAILURES (detected) — proceeding to explore"
          commit "applytest" "$ITERATION"
          STATE="explore"
        else
          echo "LIKELY PASSED — proceeding to verify"
          commit "applytest" "$ITERATION"
          STATE="verify"
          ITERATION=$((ITERATION + 1))
        fi
      fi
      ;;

    explore)
      echo "Phase: EXPLORE (Gemma 4 31B)"
      PREV=$(cat "$CYCLE_DIR/${ITERATION}-applytest.txt" 2>/dev/null || echo "No previous output found")

      EXPLORE_PROMPT="Diagnose the test failures listed below. Use the openspec-explore skill to get oriented on the change. Suggest threads for Kimi to fix. Do NOT modify any files. ORIGINAL: $ORIGINAL PREVIOUS PHASE OUTPUT: $PREV"
      OUTPUT=$(run_agent "explore-gemma" "ollama/gemma4:31b-cloud" "read,grep,find,ls" "$EXPLORE_PROMPT" 2>&1)
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