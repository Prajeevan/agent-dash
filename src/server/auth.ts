import type { Env } from './env'
import { bearer, hmacSign, hmacVerify, timingSafeEqual, ulid } from './util'

// Two independent credentials:
//   AGENT_KEY  — bearer token agents send. Long-lived. Never touches sessions.
//   APP_SECRET — HMAC key for YOUR magic-login links and session cookies.
// They rotate independently. This is single-user by design.

const COOKIE = 'ad_session'
const SESSION_PREFIX = 'sess:'
const EPOCH_KEY = 'session_epoch' // bumping this invalidates all sessions

function sessionTtlSeconds(env: Env): number {
  const days = Number(env.SESSION_TTL_DAYS ?? '30')
  return Math.max(1, days) * 86_400
}

// ── Agent auth ───────────────────────────────────────────────────────────────
export function isAgentAuthed(request: Request, env: Env): boolean {
  const token = bearer(request)
  return !!token && !!env.AGENT_KEY && timingSafeEqual(token, env.AGENT_KEY)
}

// ── Magic login link ─────────────────────────────────────────────────────────
// Token = "<expEpochMs>.<sig>" signed with APP_SECRET. Single-use is enforced
// by short expiry (15 min) rather than server state — right-sized for one user.
const LOGIN_TTL_MS = 15 * 60 * 1000

export async function mintLoginToken(env: Env): Promise<string> {
  const exp = String(Date.now() + LOGIN_TTL_MS)
  const sig = await hmacSign(env.APP_SECRET, `login.${exp}`)
  return `${exp}.${sig}`
}

export async function verifyLoginToken(env: Env, token: string): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot < 0) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false
  return hmacVerify(env.APP_SECRET, `login.${exp}`, sig)
}

// ── Sessions (KV with TTL = expiry mechanism) ────────────────────────────────
async function currentEpoch(env: Env): Promise<string> {
  return (await env.SESSIONS.get(EPOCH_KEY)) ?? '1'
}

export async function bumpEpoch(env: Env): Promise<void> {
  const cur = Number(await currentEpoch(env))
  await env.SESSIONS.put(EPOCH_KEY, String(cur + 1))
}

export async function createSession(env: Env): Promise<string> {
  const id = ulid()
  const epoch = await currentEpoch(env)
  const ttl = sessionTtlSeconds(env)
  await env.SESSIONS.put(`${SESSION_PREFIX}${id}`, epoch, { expirationTtl: ttl })
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

// True when the request carries a valid, unexpired, current-epoch session.
export async function isLoggedIn(request: Request, env: Env): Promise<boolean> {
  const cookie = readCookie(request)
  if (!cookie) return false
  const dot = cookie.indexOf('.')
  if (dot < 0) return false
  const id = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  if (!(await hmacVerify(env.APP_SECRET, id, sig))) return false
  const stored = await env.SESSIONS.get(`${SESSION_PREFIX}${id}`)
  if (!stored) return false // expired or logged out
  const epoch = await currentEpoch(env)
  return stored === epoch
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const cookie = readCookie(request)
  if (!cookie) return
  const id = cookie.split('.')[0]
  if (id) await env.SESSIONS.delete(`${SESSION_PREFIX}${id}`)
}
