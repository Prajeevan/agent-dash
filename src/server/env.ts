export interface Env {
  DB: D1Database
  SESSIONS: KVNamespace
  HUB: DurableObjectNamespace // instant-mode fan-out (only used when INSTANT=1)

  // Secrets (set via `wrangler secret put`)
  APP_SECRET: string // HMAC key for session integrity + OTP hashing
  RESEND_API_KEY?: string // Resend API key for sending OTP emails. Unset in dev → code is logged.
  VAPID_PUBLIC_KEY: string // base64url, also served to the browser
  VAPID_PRIVATE_KEY: string // base64url (raw d) for signing push JWTs
  VAPID_SUBJECT?: string // "mailto:you@example.com" — optional, has a default

  // Legacy: single shared agent key. No longer used for auth — each account has
  // its own key now. Left optional so existing deployments don't break on boot.
  AGENT_KEY?: string

  // Vars (set in wrangler.jsonc [vars] or left unset for defaults)
  EMAIL_FROM?: string // "Agent Dash <login@yourdomain>" — sender for OTP mail
  APP_URL?: string // canonical hosted URL, e.g. "https://agentdash.example"
  SESSION_TTL_DAYS?: string
  EVENT_RETENTION_DAYS?: string
  INSTANT?: string // "1" enables the Durable Object live feed (Pro / opt-in)
}
