#!/usr/bin/env node
// One-command setup: generate credentials, push them as Worker secrets, apply
// the D1 schema, and print your magic login link + the agent connection snippet.
//
//   pnpm setup
//
// Safe to re-run: pass --rotate to mint brand-new keys (invalidates old ones).
import { randomKey, generateVapidKeys, mintLoginToken, loadSecrets, saveSecrets, putSecret, wrangler, readWorkerName } from './lib.mjs'

const rotate = process.argv.includes('--rotate')
const existing = loadSecrets()

let secrets
if (existing && !rotate) {
  console.log('↺ Reusing existing credentials from .agent-dash.local.json (pass --rotate to regenerate).\n')
  secrets = existing
} else {
  const vapid = generateVapidKeys()
  secrets = {
    AGENT_KEY: randomKey(32),
    APP_SECRET: randomKey(32),
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: existing?.VAPID_SUBJECT || 'mailto:admin@agent-dash.local',
  }
  saveSecrets(secrets)
  console.log('✓ Generated credentials → .agent-dash.local.json (gitignored)\n')
}

console.log('→ Applying database schema…')
wrangler(['d1', 'migrations', 'apply', 'agent-dash', '--remote'])

console.log('\n→ Setting Worker secrets…')
for (const name of ['AGENT_KEY', 'APP_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
  putSecret(name, secrets[name])
}

console.log('\n→ Deploying…')
wrangler(['deploy'])

const name = readWorkerName()
console.log('\n────────────────────────────────────────────────────────')
console.log('✅ Agent Dash is live.\n')
console.log('Your worker URL is shown above (https://' + name + '.<your-subdomain>.workers.dev).')
console.log('\n1. Open this magic link ON YOUR PHONE to log in (valid 15 min):')
console.log('   <YOUR_URL>/login?t=' + mintLoginToken(secrets.APP_SECRET))
console.log('   (run `pnpm login` any time to mint a fresh link)\n')
console.log('2. Add the app to your Home Screen, then enable notifications in Settings.\n')
console.log('3. Give an agent this MCP config (or the curl snippet in Settings):')
console.log('   {"mcpServers":{"agent-dash":{"url":"<YOUR_URL>/mcp",')
console.log('     "headers":{"Authorization":"Bearer ' + secrets.AGENT_KEY + '"}}}}\n')
console.log('   AGENT_KEY: ' + secrets.AGENT_KEY)
console.log('────────────────────────────────────────────────────────')
