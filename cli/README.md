# agentdash (CLI)

Connect an agent to your Agent Dash hub, log in on your phone, and send
updates/questions from scripts.

```bash
npx agentdash login            # save + verify your hub URL and agent key
npx agentdash connect          # write ./.mcp.json so your agent can call the hub
npx agentdash open             # QR to open the dashboard on your phone
npx agentdash notify "Deploy finished" --priority 1 --project "API"
npx agentdash ask "Ship it?" --button Ship --button Hold   # waits, prints the answer JSON
npx agentdash status
```

Credentials resolve from flags → env (`AGENT_DASH_URL`, `AGENT_KEY`,
`AGENT_DASH_ENC_KEY`) → saved config at `~/.config/agent-dash/config.json`.

## End-to-end encryption

Pass an encryption key at login and the CLI encrypts block content before it
leaves your machine — the hub stores ciphertext it can't read:

```bash
npx agentdash login --url … --key … --enc-key <ENC_KEY>
npx agentdash notify "Secret result" --markdown "sensitive…" --e2e
```

Set the same `ENC_KEY` in the phone app (Settings → Encryption) so it can
decrypt. The key never touches the server. See the root README for the full
E2E design.

## Publish

```bash
cd cli && npm publish        # name may need scoping if "agent-dash" is taken
```
