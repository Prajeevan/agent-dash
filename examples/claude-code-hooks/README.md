# Claude Code hooks → Agent Dash

Get a push on your phone when Claude Code **starts**, **finishes**, or **needs
your input** — no MCP, no skill, just a shell hook.

## Setup

1. Make the script executable:
   ```bash
   chmod +x notify.sh
   ```

2. Export your hub credentials (add to `~/.zshrc` / `~/.bashrc` to persist):
   ```bash
   export AGENT_DASH_URL="https://agent-dash.your-name.workers.dev"
   export AGENT_KEY="your-agent-key"
   ```

3. Merge the `hooks` block from `settings.json` into your Claude Code
   `settings.json` (user-level `~/.claude/settings.json`, or project
   `.claude/settings.json`). Fix the path to `notify.sh`.

That's it. Next session:
- **Session start** → a quiet "Session started" event.
- **Claude stops** (done responding) → a `priority: 1` push: "Claude finished — ready for you".
- **Claude needs input** (permission/idle prompt) → a `priority: 2` push that rings through quiet hours.

## Notes

- The hook fails silently if the network or credentials are missing — it never
  blocks or slows your session.
- `jq` is optional; if present, the notification includes which project the
  session is in.
- Change the titles/priorities in `settings.json` to taste. See the
  [skill](../../skills/agent-dash/SKILL.md) for the full event/block schema.
