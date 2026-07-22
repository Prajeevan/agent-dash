import type { Env } from './env'
import { b64urlDecode, b64urlEncode } from './util'

// ── Web Push, hand-rolled on WebCrypto so it runs in workerd (no Node deps) ──
// Two pieces per push:
//   1. VAPID: an ES256 JWT proving we own the app server key (identifies us to
//      the push service, e.g. FCM/Mozilla/Apple).
//   2. Payload encryption: RFC 8291 "aes128gcm" — ECDH(our ephemeral P-256,
//      subscriber's p256dh) → HKDF → AES-128-GCM. The push service can't read it.
//
// Subscription shape (from the browser's PushSubscription.toJSON()):
//   { endpoint, keys: { p256dh, auth } }  — both keys base64url.

export interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// ── VAPID JWT (ES256) ────────────────────────────────────────────────────────
async function importVapidPrivate(env: Env): Promise<CryptoKey> {
  // Private key stored as base64url raw scalar `d` (32 bytes). Rebuild a JWK
  // using the public key's x/y so WebCrypto can import an ECDSA signing key.
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY) // 65 bytes: 0x04 || x || y
  const d = env.VAPID_PRIVATE_KEY
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d,
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function vapidHeader(env: Env, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@agent-dash.local',
  }
  const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)))
  const signingInput = `${enc(header)}.${enc(payload)}`
  const key = await importVapidPrivate(env)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )
  // WebCrypto returns raw r||s (64 bytes) — exactly JOSE ES256 format.
  return `${signingInput}.${b64urlEncode(sig)}`
}

// ── Payload encryption (RFC 8291, aes128gcm) ─────────────────────────────────
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  len: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8)
  return new Uint8Array(bits)
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(new ArrayBuffer(total))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function encryptPayload(
  sub: PushSubscription,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(sub.keys.p256dh) // 65 bytes
  const authSecret = b64urlDecode(sub.keys.auth) // 16 bytes

  // Our ephemeral ECDH key pair.
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const localPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey)) // 65 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, local.privateKey, 256),
  )

  // PRK_key = HKDF(authSecret, ECDH, "WebPush: info\0" || uaPublic || localPublic, 32)
  const keyInfo = concat(
    new TextEncoder().encode('WebPush: info\0'),
    uaPublic,
    localPublicRaw,
  )
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)

  // Record = plaintext || 0x02 (last-record delimiter), then AES-128-GCM.
  const record = concat(plaintext, new Uint8Array([0x02]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  )

  // aes128gcm header: salt(16) || rs(4, big-endian) || idlen(1) || keyid || ciphertext
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([localPublicRaw.length]), localPublicRaw, ct)
}

// Send one push. Returns the HTTP status (410/404 => subscription is dead).
export async function sendPush(
  env: Env,
  sub: PushSubscription,
  notification: unknown,
): Promise<number> {
  const body = await encryptPayload(sub, new TextEncoder().encode(JSON.stringify(notification)))
  const jwt = await vapidHeader(env, sub.endpoint)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  })
  return res.status
}

// Fan out to every stored subscription, pruning any that report gone.
export async function pushToAll(env: Env, notification: unknown): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id, endpoint, keys FROM push_subscriptions').all<{
    id: string
    endpoint: string
    keys: string
  }>()
  await Promise.all(
    (results ?? []).map(async (row) => {
      const sub: PushSubscription = { endpoint: row.endpoint, keys: JSON.parse(row.keys) }
      try {
        const status = await sendPush(env, sub, notification)
        if (status === 404 || status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(row.id).run()
        }
      } catch {
        // Network hiccup — leave the subscription, try again next event.
      }
    }),
  )
}
