#!/usr/bin/env bash
# Post an Agent Dash event from a Claude Code hook.
# Reads the hook's JSON payload on stdin, and AGENT_DASH_URL / AGENT_KEY from env.
#
# Usage (from a hook command):
#   notify.sh "<title>" <priority> "<kind>"
#
# Requires: curl, and (optional) jq for richer titles. Fails silently so a hook
# never blocks your session.

set -euo pipefail

TITLE="${1:-Claude Code}"
PRIORITY="${2:-0}"
KIND="${3:-update}"

: "${AGENT_DASH_URL:?set AGENT_DASH_URL}" 2>/dev/null || exit 0
: "${AGENT_KEY:?set AGENT_KEY}" 2>/dev/null || exit 0

# Try to pull the working directory / session id out of the hook payload for context.
PAYLOAD="$(cat 2>/dev/null || true)"
CWD=""
if command -v jq >/dev/null 2>&1 && [ -n "$PAYLOAD" ]; then
  CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // .transcript_path // empty' 2>/dev/null || true)"
fi

BLOCKS='[]'
if [ -n "$CWD" ]; then
  BLOCKS="$(printf '[{"type":"keyvalue","items":[{"k":"Where","v":"%s"}]}]' "$(basename "$CWD")")"
fi

curl -sS -m 8 -X POST "$AGENT_DASH_URL/api/v1/events" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"agent":"claude-code","task_id":"%s","title":"%s","priority":%s,"kind":"%s","blocks":%s}' \
        "$(basename "${CWD:-session}")" "$TITLE" "$PRIORITY" "$KIND" "$BLOCKS")" \
  >/dev/null 2>&1 || true
