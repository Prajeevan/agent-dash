#!/usr/bin/env node
// Mint a fresh 15-minute magic login link from your local credentials.
//   pnpm run login
import { loadSecrets, mintLoginToken, readWorkerName } from './lib.mjs'

const secrets = loadSecrets()
if (!secrets) {
  console.error('No .agent-dash.local.json found. Run `pnpm setup` first.')
  process.exit(1)
}

const token = mintLoginToken(secrets.APP_SECRET)
console.log('\nOpen this on the device you want to log in (valid 15 minutes):\n')
if (secrets.WORKER_URL) {
  console.log(`  ${secrets.WORKER_URL.replace(/\/$/, '')}/login?t=${token}\n`)
} else {
  const name = readWorkerName()
  console.log(`  https://${name}.<your-subdomain>.workers.dev/login?t=${token}\n`)
  console.log('Tip: add "WORKER_URL" to .agent-dash.local.json to get a ready-to-click link.\n')
}
