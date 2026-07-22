import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import qrcode from 'qrcode-terminal'

// ── config ───────────────────────────────────────────────────────────────────
export const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'agent-dash')
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

// Resolve url + key from flags → env → saved config.
export function resolve(flags = {}) {
  const cfg = loadConfig()
  return {
    url: (flags.url || process.env.AGENT_DASH_URL || cfg.url || '').replace(/\/$/, ''),
    key: flags.key || process.env.AGENT_KEY || cfg.key || '',
    encKey: flags['enc-key'] || process.env.AGENT_DASH_ENC_KEY || cfg.encKey || '',
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
export async function hub(method, path, { url, key }, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

// True if url+key reach the hub and authenticate.
export async function verify({ url, key }) {
  if (!url || !key) return false
  try {
    const { status } = await hub('GET', '/api/v1/inbox?limit=1', { url, key })
    return status === 200
  } catch {
    return false
  }
}

// ── E2E crypto (AES-256-GCM with a shared key the hub never sees) ────────────
// Envelope: base64( iv(12) || ciphertext+tag ). Same scheme in the browser.
export function newEncKey() {
  return b64url(randomBytes(32))
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function importKey(encKey) {
  return crypto.subtle.importKey('raw', b64urlDecode(encKey), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// Encrypt any JSON-serializable value → opaque string for the `blocks` field.
export async function encrypt(encKey, value) {
  const key = await importKey(encKey)
  const iv = randomBytes(12)
  const pt = new TextEncoder().encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return b64url(out)
}

export async function decrypt(encKey, envelope) {
  const key = await importKey(encKey)
  const raw = b64urlDecode(envelope)
  const iv = raw.subarray(0, 12)
  const ct = raw.subarray(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt))
}

// ── display ──────────────────────────────────────────────────────────────────
export function qr(text) {
  qrcode.generate(text, { small: true }, (out) => console.log(out))
}

export function die(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
