#!/usr/bin/env bash
# UserPromptSubmit hook: appends each user prompt with a timestamp to docs/PROMPTS.md.
set -euo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file="$root/docs/PROMPTS.md"
input="$(cat)"
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty')"
session="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"
[ -z "$prompt" ] && exit 0
{
  printf '\n## %s — session %s\n\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "${session:0:8}"
  printf '%s\n' "$prompt" | sed 's/^/> /'
} >> "$file"
