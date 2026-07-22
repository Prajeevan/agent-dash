import type { Env } from './env'
import { bearer, hmacSign, hmacVerify, ulid, sha256hex, randomToken, numericCode, now } from './util'
import { sendOtpEmail } from './email'

// Two independent credentials:
//   agent key  — per-account bearer token agents send. Stored only as a hash.
//   APP_SECRET — HMAC key for session-cookie integrity + OTP hashing.
// Sessions are bound to one account; all data is scoped to that account.

const COOKIE = 'ad_session'
const SESSION_PREFIX = 'sess:'

function sessionTtlSeconds(env: Env): number {
  const days = Number(env.SESSION_TTL_DAYS ?? '30')
  return Math.max(1, days) * 86_400
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface Account {
  id: string
  email: string
  agent_key_prefix: string
}

// Mint a fresh agent key. `ad_live_` prefix makes it recognizable in logs/config.
function mintAgentKey(): string {
  return `ad_live_${randomToken(24)}`
}

function keyPrefix(key: string): string {
  return key.slice(0, 16) // "ad_live_" + 8 chars — enough to identify, not to use
}

// Resolve the account for an agent request from its bearer token. Returns the
// account id, or null if the token doesn't match any account. The lookup is an
// indexed exact-match on a SHA-256 hash of the presented token.
export async function authedAccount(request: Request, env: Env): Promise<string | null> {
  const token = bearer(request)
  if (!token) return null
  const hash = await sha256hex(token)
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE agent_key_hash = ?1')
    .bind(hash)
    .first<{ id: string }>()
  return row?.id ?? null
}

// Find the account for an email, or create one. On create we mint a key and
// return it in plaintext ONCE (only the hash is stored). last_login_at is
// stamped either way.
async function findOrCreateAccount(
  env: Env,
  email: string,
): Promise<{ account: Account; agentKey: string | null }> {
  const existing = await env.DB.prepare(
    'SELECT id, email, agent_key_prefix FROM accounts WHERE email = ?1',
  )
    .bind(email)
    .first<Account>()
  if (existing) {
    await env.DB.prepare('UPDATE accounts SET last_login_at = ?1 WHERE id = ?2')
      .bind(now(), existing.id)
      .run()
    return { account: existing, agentKey: null }
  }

  const id = ulid()
  const agentKey = mintAgentKey()
  const prefix = keyPrefix(agentKey)
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, agent_key_hash, agent_key_prefix, created_at, last_login_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(id, email, await sha256hex(agentKey), prefix, now())
    .run()
  return { account: { id, email, agent_key_prefix: prefix }, agentKey }
}

// Rotate an account's agent key. Invalidates the old one immediately; returns
// the new key in plaintext once.
export async function rotateAgentKey(env: Env, accountId: string): Promise<string> {
  const agentKey = mintAgentKey()
  await env.DB.prepare('UPDATE accounts SET agent_key_hash = ?1, agent_key_prefix = ?2 WHERE id = ?3')
    .bind(await sha256hex(agentKey), keyPrefix(agentKey), accountId)
    .run()
  return agentKey
}

export async function getAccount(env: Env, accountId: string): Promise<Account | null> {
  return env.DB.prepare('SELECT id, email, agent_key_prefix FROM accounts WHERE id = ?1')
    .bind(accountId)
    .first<Account>()
}

// ── One-time login codes (OTP) ───────────────────────────────────────────────
// Stored in KV with a TTL so expiry is automatic. We keep only a hash of the
// code (salted with APP_SECRET), plus an attempt counter to cap brute force.

const OTP_TTL_SECONDS = 10 * 60
const OTP_MAX_ATTEMPTS = 5
const OTP_RATE_MAX = 5 // codes requestable per email per window
const OTP_RATE_WINDOW = 60 * 60 // 1 hour
const OTP_IP_MAX = 20 // codes requestable per IP per hour
const OTP_GLOBAL_MAX = 500 // total codes sent across all users per hour (abuse ceiling)

// A small counter in KV, keyed by the caller-supplied key, that resets every
// window. Returns true if incrementing kept it at/under `max`, false if the cap
// is already hit. Guards Resend from an email-bomb that fans across many
// distinct addresses (which the per-email limit alone can't stop).
async function underRateLimit(env: Env, key: string, max: number, windowSec: number): Promise<boolean> {
  const count = Number((await env.SESSIONS.get(key)) ?? '0')
  if (count >= max) return false
  await env.SESSIONS.put(key, String(count + 1), { expirationTtl: windowSec })
  return true
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null
}

interface OtpRecord {
  hash: string
  attempts: number
}

// Generate + store + send a login code. Rate-limited three ways — per email,
// per IP, and a global hourly ceiling — so no single address, client, or
// attacker fanning across many addresses can email-bomb or exhaust the Resend
// quota. Returns false when any limit trips (caller still responds 200 to avoid
// enumeration). `ip` is the caller's IP (from cf-connecting-ip), '' if unknown.
export async function requestLoginCode(env: Env, email: string, ip: string): Promise<boolean> {
  const hourBucket = Math.floor(now() / 3_600_000)
  if (!(await underRateLimit(env, `otprl:global:${hourBucket}`, OTP_GLOBAL_MAX, OTP_RATE_WINDOW))) return false
  if (ip && !(await underRateLimit(env, `otprl:ip:${ip}:${hourBucket}`, OTP_IP_MAX, OTP_RATE_WINDOW))) return false
  if (!(await underRateLimit(env, `otprl:email:${email}`, OTP_RATE_MAX, OTP_RATE_WINDOW))) return false

  const code = numericCode(6)
  const record: OtpRecord = { hash: await sha256hex(`${code}.${env.APP_SECRET}`), attempts: 0 }
  await env.SESSIONS.put(`otp:${email}`, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS })
  await sendOtpEmail(env, email, code)
  return true
}

export type VerifyResult =
  | { ok: true; account: Account; agentKey: string | null }
  | { ok: false; error: string }

// Check a submitted code. On success, consumes the code and find-or-creates the
// account. On failure, increments the attempt counter and voids the code once
// the cap is hit.
export async function verifyLoginCode(env: Env, email: string, code: unknown): Promise<VerifyResult> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return { ok: false, error: 'Enter the 6-digit code.' }
  }
  const otpKey = `otp:${email}`
  const raw = await env.SESSIONS.get(otpKey)
  if (!raw) return { ok: false, error: 'That code has expired. Request a new one.' }

  let record: OtpRecord
  try {
    record = JSON.parse(raw) as OtpRecord
  } catch {
    await env.SESSIONS.delete(otpKey)
    return { ok: false, error: 'That code is invalid. Request a new one.' }
  }

  const submitted = await sha256hex(`${code.trim()}.${env.APP_SECRET}`)
  if (submitted !== record.hash) {
    const attempts = record.attempts + 1
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await env.SESSIONS.delete(otpKey)
      return { ok: false, error: 'Too many attempts. Request a new code.' }
    }
    await env.SESSIONS.put(otpKey, JSON.stringify({ ...record, attempts }), {
      expirationTtl: OTP_TTL_SECONDS,
    })
    return { ok: false, error: 'Incorrect code. Try again.' }
  }

  await env.SESSIONS.delete(otpKey)
  const { account, agentKey } = await findOrCreateAccount(env, email)
  return { ok: true, account, agentKey }
}

// ── Sessions (KV with TTL, bound to one account) ─────────────────────────────
// Per-account epoch: bumping it logs that account out everywhere without
// touching anyone else's sessions.

async function currentEpoch(env: Env, accountId: string): Promise<string> {
  return (await env.SESSIONS.get(`epoch:${accountId}`)) ?? '1'
}

export async function bumpEpoch(env: Env, accountId: string): Promise<void> {
  const cur = Number(await currentEpoch(env, accountId))
  await env.SESSIONS.put(`epoch:${accountId}`, String(cur + 1))
}

export async function createSession(env: Env, accountId: string): Promise<string> {
  const id = ulid()
  const epoch = await currentEpoch(env, accountId)
  const ttl = sessionTtlSeconds(env)
  // Store the owning account with the epoch so we can resolve identity + revoke.
  await env.SESSIONS.put(`${SESSION_PREFIX}${id}`, `${epoch}:${accountId}`, { expirationTtl: ttl })
  // Sign the cookie value so a stolen KV key alone isn't a valid cookie.
  const sig = await hmacSign(env.APP_SECRET, id)
  return `${id}.${sig}`
}

export function sessionCookie(value: string, env: Env): string {
  const ttl = sessionTtlSeconds(env)
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${ttl}`,
  ].join('; ')
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function readCookie(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? ''
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === COOKIE) return part.slice(eq + 1)
  }
  return null
}

// Resolve the account id for a request carrying a valid, unexpired,
// current-epoch session — or null. Replaces the old boolean isLoggedIn.
export async function sessionAccount(request: Request, env: Env): Promise<string | null> {
  const cookie = readCookie(request)
  if (!cookie) return null
  const dot = cookie.indexOf('.')
  if (dot < 0) return null
  const id = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  if (!(await hmacVerify(env.APP_SECRET, id, sig))) return null
  const stored = await env.SESSIONS.get(`${SESSION_PREFIX}${id}`)
  if (!stored) return null // expired or logged out
  const sep = stored.indexOf(':')
  if (sep < 0) return null
  const epoch = stored.slice(0, sep)
  const accountId = stored.slice(sep + 1)
  if (!accountId) return null
  if (epoch !== (await currentEpoch(env, accountId))) return null
  return accountId
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const cookie = readCookie(request)
  if (!cookie) return
  const id = cookie.split('.')[0]
  if (id) await env.SESSIONS.delete(`${SESSION_PREFIX}${id}`)
}
