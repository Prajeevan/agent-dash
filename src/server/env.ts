export interface Env {
  DB: D1Database
  SESSIONS: KVNamespace
  HUB: DurableObjectNamespace // instant-mode fan-out (only used when INSTANT=1)

  // Secrets (set via `wrangler secret put`)
  AGENT_KEY: string // bearer token agents send on every API/MCP call
  APP_SECRET: string // HMAC key for magic-login links + session integrity
  VAPID_PUBLIC_KEY: string // base64url, also served to the browser
  VAPID_PRIVATE_KEY: string // base64url (raw d) for signing push JWTs
  VAPID_SUBJECT?: string // "mailto:you@example.com" — optional, has a default

  // Vars (set in wrangler.jsonc [vars] or left unset for defaults)
  SESSION_TTL_DAYS?: string
  EVENT_RETENTION_DAYS?: string
  INSTANT?: string // "1" enables the Durable Object live feed (Pro / opt-in)
}
