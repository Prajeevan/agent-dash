#!/usr/bin/env node
// One-command setup: generate credentials, push them as Worker secrets, apply
// the D1 schema, and print your magic login link + the agent connection snippet.
//
//   pnpm setup
//
// Safe to re-run: pass --rotate to mint brand-new keys (invalidates old ones).
import { randomKey, generateVapidKeys, mintLoginToken, loadSecrets, saveSecrets, putSecret, wrangler, readWorkerName, printLoginQr } from './lib.mjs'

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
const token = mintLoginToken(secrets.APP_SECRET)
if (secrets.WORKER_URL) {
  // We know the URL — show a scannable QR right here.
  printLoginQr(`${secrets.WORKER_URL.replace(/\/$/, '')}/login?t=${token}`)
} else {
  console.log('Your worker URL is shown above (https://' + name + '.<your-subdomain>.workers.dev).')
  console.log('Tip: add that URL as "WORKER_URL" to .agent-dash.local.json, then run')
  console.log('`pnpm run login` for a scannable QR code.\n')
  console.log('1. Open this magic link ON YOUR PHONE to log in (valid 15 min):')
  console.log('   <YOUR_URL>/login?t=' + token)
}
console.log('Give an agent this MCP config (or the curl snippet in Settings):')
console.log('   {"mcpServers":{"agent-dash":{"url":"' + (secrets.WORKER_URL || '<YOUR_URL>') + '/mcp",')
console.log('     "headers":{"Authorization":"Bearer ' + secrets.AGENT_KEY + '"}}}}\n')
console.log('   AGENT_KEY: ' + secrets.AGENT_KEY)
console.log('────────────────────────────────────────────────────────')
