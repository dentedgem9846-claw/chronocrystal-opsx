## Subagent Research Pattern

### Overview
A reusable pattern for delegating research questions to a pi coding agent running in an isolated tmux session, then extracting structured findings.

### Architecture

```
Orchestrator (main session)
  │
  ├── 1. Create tmux session with pi agent
  ├── 2. Send structured research prompt (with session ID)
  ├── 3. Poll tmux pane for pi idle prompt (completion signal)
  ├── 4. Read /tmp/findings-<SESSION_ID>.md for structured output
  ├── 5. Kill tmux session
  └── 6. Parse and use findings
```

### Subagent Prompt Template

```
You are a research subagent. Your job is to investigate a specific question against the actual codebase and return structured findings. You have access to read files, search code, and run commands.

## Mission
<INSERT SPECIFIC QUESTION OR TASK HERE>

## Process
1. Start by understanding what you need to find. Identify the key files, packages, or APIs to investigate.
2. Read the actual source code and type definitions. Do not guess or rely on memory.
3. For each finding, cite the exact file path and line number or type definition.
4. If something is ambiguous, say so explicitly — don't paper over gaps.

## Output Format
Write your final structured findings to /tmp/findings-<SESSION_ID>.md (see top of prompt for session ID).

Use this structure in the file:

### Finding: <topic>
- **What**: <what you found, stated precisely>
- **Where**: <file:line or type definition>
- **Implication**: <what this means for the question at hand>
- **Confidence**: high/medium/low

<repeat for each finding>

### Summary
<one concise paragraph answering the original question>

### Open Questions
<anything you couldn't resolve from the code alone>
```

### Orchestrator Script Pattern

```bash
SESSION_NAME="research-$(date +%s)"
SESSION_ID="$SESSION_NAME"
WORK_DIR="/path/to/project"
FINDINGS_FILE="/tmp/findings-${SESSION_ID}.md"

# 1. Create isolated tmux session with pi agent
tmux new-session -d -s "$SESSION_NAME" -c "$WORK_DIR"
tmux send-keys -t "$SESSION_NAME" 'pi' Enter
sleep 4  # wait for initialization

# 2. Construct prompt with session ID embedded
PROMPT="You are a research subagent...

## Mission
YOUR_QUESTION_HERE

## Output
Write findings to /tmp/findings-${SESSION_ID}.md

... (rest of template)
"

# 3. Send prompt via tmux buffer (avoids shell escaping issues)
echo "$PROMPT" | tmux load-buffer -
tmux paste-buffer -t "$SESSION_NAME"
tmux send-keys -t "$SESSION_NAME" Enter

# 4. Wait for completion — poll until pi prompt reappears
MAX_WAIT=300
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    PANE=$(tmux capture-pane -t "$SESSION_NAME" -p | tail -3)
    if echo "$PANE" | grep -qP '\(ollama\)'; then
        sleep 2  # confirm it's truly idle
        PANE2=$(tmux capture-pane -t "$SESSION_NAME" -p | tail -3)
        if echo "$PANE2" | grep -qP '\(ollama\)'; then
            break
        fi
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

# 5. Read structured findings
cat "$FINDINGS_FILE"

# 6. Clean up
tmux kill-session -t "$SESSION_NAME"
```

### Completion Detection

The pi agent shows its prompt line (containing the model identifier like `(ollama)`) when idle. When working, it shows a spinner character. Poll for the idle prompt to detect completion.

Add a 2-second confirmation delay after first detection to avoid false positives during brief pauses.

### Clean Extraction

Always use the file-write approach (`/tmp/findings-<id>.md`) rather than parsing terminal output. Terminal output contains shell prompts, ANSI codes, progress spinners, and line wrapping artifacts that make reliable extraction difficult.

The findings file is pure structured content with no terminal noise.