#!/bin/bash
# User prompt submit hook - detects multi-step tasks
# Suggests planning-with-files when appropriate

set -e

# Read user prompt from stdin (available in Claude Code 2.0.64+)
USER_PROMPT=$(cat)

# Multi-step task indicators
MULTI_STEP_KEYWORDS=(
  "optimize"
  "refactor"
  "migrate"
  "integrate"
  "add.*api"
  "schema.*change"
  "queue.*tune"
  "backfill"
  "performance"
  "add.*endpoint"
  "new.*feature"
  "fix.*queue"
  "improve.*performance"
)

# Check for multi-step indicators
for keyword in "${MULTI_STEP_KEYWORDS[@]}"; do
  if echo "$USER_PROMPT" | grep -qiE "$keyword"; then
    echo "additionalContext: 🚨 MULTI-STEP TASK DETECTED 🚨

This request appears to require >5 tool calls. As a strong PM:

1. FIRST: Invoke /planning-with-files skill (or relevant domain skill)
2. Create: task_plan.md, findings.md, progress.md
3. Delegate to specialized agents IN PARALLEL when possible
4. Validate outputs via PAL MCP before acceptance

DO NOT start implementation without planning files.

Remember: Alexandria is a family fun project - keep solutions pragmatic and maintainable by one person."
    exit 0
  fi
done

# No multi-step detected - proceed normally
exit 0
