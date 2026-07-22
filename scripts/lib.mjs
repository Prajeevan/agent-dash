// Shared helpers for the setup + login scripts. Node-only (uses node:crypto).
import { generateKeyPairSync, randomBytes, createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export const SECRETS_FILE = '.agent-dash.local.json'

export function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomKey(bytes = 32) {
  return b64url(randomBytes(bytes))
}

// VAPID P-256 keypair in Web Push format:
//   public  = base64url( 0x04 || X(32) || Y(32) )  (uncompressed point, 65 bytes)
//   private = base64url( d(32) )                    (raw scalar)
export function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pubJwk = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })
  const x = Buffer.from(pubJwk.x, 'base64url')
  const y = Buffer.from(pubJwk.y, 'base64url')
  const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y])
  return {
    publicKey: b64url(uncompressed),
    privateKey: b64url(Buffer.from(privJwk.d, 'base64url')),
  }
}

// A 15-minute magic-login token, HMAC-signed with APP_SECRET (mirrors auth.ts).
export function mintLoginToken(appSecret) {
  const exp = String(Date.now() + 15 * 60 * 1000)
  const sig = b64url(createHmac('sha256', appSecret).update(`login.${exp}`).digest())
  return `${exp}.${sig}`
}

export function loadSecrets() {
  if (!existsSync(SECRETS_FILE)) return null
  return JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
}

export function saveSecrets(secrets) {
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2))
}

// Pipe a value into `wrangler secret put NAME` (non-interactive).
export function putSecret(name, value) {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  })
  if (res.status !== 0) throw new Error(`Failed to set secret ${name}`)
}

export function wrangler(args, opts = {}) {
  return spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit', encoding: 'utf8', ...opts })
}

// Read the deployed worker URL from wrangler.jsonc name + account subdomain.
export function readWorkerName() {
  const raw = readFileSync('wrangler.jsonc', 'utf8').replace(/\/\/.*$/gm, '')
  const m = raw.match(/"name"\s*:\s*"([^"]+)"/)
  return m ? m[1] : 'agent-dash'
}
