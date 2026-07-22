#!/usr/bin/env node
// Mint a fresh 15-minute magic login link from your local credentials.
//   pnpm login
import { loadSecrets, mintLoginToken, readWorkerName } from './lib.mjs'

const secrets = loadSecrets()
if (!secrets) {
  console.error('No .agent-dash.local.json found. Run `pnpm setup` first.')
  process.exit(1)
}

const token = mintLoginToken(secrets.APP_SECRET)
const name = readWorkerName()
console.log('\nOpen this on the device you want to log in (valid 15 minutes):\n')
console.log(`  https://${name}.<your-subdomain>.workers.dev/login?t=${token}\n`)
console.log('Replace <your-subdomain> with your workers.dev subdomain (shown after deploy),')
console.log('or use your custom domain.\n')
