// Small dependency-free helpers shared across the worker.

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

export function now(): number {
  return Date.now()
}

// ── ULID: time-sortable, URL-safe id. Crockford base32, 48-bit time + 80-bit random.
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function ulid(time = Date.now()): string {
  let out = ''
  let t = time
  for (let i = 9; i >= 0; i--) {
    out = ENC[t % 32] + out
    t = Math.floor(t / 32)
  }
  const rnd = new Uint8Array(16)
  crypto.getRandomValues(rnd)
  for (let i = 0; i < 16; i++) out += ENC[rnd[i] % 32]
  return out
}

// ── base64url (no padding) helpers, for VAPID keys and JWTs.
export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Constant-time string compare, for token checks.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── HMAC-SHA256 sign/verify, used for magic-login tokens and session cookies.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return b64urlEncode(sig)
}

export async function hmacVerify(secret: string, data: string, sig: string): Promise<boolean> {
  const expected = await hmacSign(secret, data)
  return timingSafeEqual(expected, sig)
}

// ── SHA-256 → lowercase hex. Used to store agent keys as a hash (never the
// raw key) and to hash OTP codes before they touch KV.
export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

// ── A high-entropy URL-safe random token (default 32 bytes → ~43 chars).
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return b64urlEncode(buf)
}

// ── A numeric one-time code, cryptographically random, fixed length (default 6).
export function numericCode(digits = 6): string {
  const buf = new Uint32Array(1)
  let out = ''
  for (let i = 0; i < digits; i++) {
    crypto.getRandomValues(buf)
    out += (buf[0] % 10).toString()
  }
  return out
}

// Read the agent bearer token from an Authorization header.
export function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}
