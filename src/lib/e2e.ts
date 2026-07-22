// Browser-side end-to-end encryption. The key lives only here (localStorage) —
// it never goes to the server. Same AES-256-GCM envelope as the CLI:
// base64url( iv(12) || ciphertext+tag ).

const KEY_STORE = 'ad_enc_key'

export function getEncKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE)
  } catch {
    return null
  }
}
export function setEncKey(k: string) {
  localStorage.setItem(KEY_STORE, k.trim())
}
export function clearEncKey() {
  localStorage.removeItem(KEY_STORE)
}

// A fresh 256-bit key (base64url) to share between this device and your agent.
export function generateEncKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The login QR can carry the key in the URL fragment (#k=…) so it never hits
// the server. Capture it on load and scrub the hash.
export function captureKeyFromHash() {
  if (typeof window === 'undefined' || !window.location.hash) return
  const m = window.location.hash.match(/[#&]k=([^&]+)/)
  if (m) {
    setEncKey(decodeURIComponent(m[1]))
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importKey(k: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64urlToBytes(k), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptValue(k: string, value: unknown): Promise<string> {
  const key = await importKey(k)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const pt = new TextEncoder().encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return bytesToB64url(out)
}

export async function decryptValue<T = unknown>(k: string, envelope: string): Promise<T> {
  const key = await importKey(k)
  const raw = b64urlToBytes(envelope)
  const iv = raw.subarray(0, 12)
  const ct = raw.subarray(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt)) as T
}
