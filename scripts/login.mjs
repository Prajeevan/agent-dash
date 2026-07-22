#!/usr/bin/env node
// Mint a fresh 15-minute magic login link and show a scannable QR.
//   pnpm run login
import { loadSecrets, mintLoginToken, readWorkerName, printLoginQr } from './lib.mjs'

const secrets = loadSecrets()
if (!secrets) {
  console.error('No .agent-dash.local.json found. Run `pnpm setup` first.')
  process.exit(1)
}

const token = mintLoginToken(secrets.APP_SECRET)
let base = secrets.WORKER_URL
if (!base) {
  const name = readWorkerName()
  base = `https://${name}.<your-subdomain>.workers.dev`
  console.log('\nTip: add "WORKER_URL" to .agent-dash.local.json for a scannable QR + ready link.')
}
const url = `${base.replace(/\/$/, '')}/login?t=${token}`

if (secrets.WORKER_URL) {
  printLoginQr(url)
} else {
  console.log(`\n  ${url}\n  (replace <your-subdomain> with your workers.dev subdomain)\n`)
}
