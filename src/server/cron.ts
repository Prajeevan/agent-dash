import type { Env } from './env'
import { now } from './util'

// Hourly housekeeping (wrangler.jsonc crons). Keeps the inbox an inbox:
//   1. Expire overdue pending questions so polling agents get a verdict.
//   2. Delete events past their retention TTL (questions cascade).
export async function runCron(env: Env): Promise<void> {
  const t = now()
  await env.DB.prepare(
    `UPDATE questions SET status = 'expired' WHERE status = 'pending' AND timeout_at < ?1`,
  )
    .bind(t)
    .run()
  await env.DB.prepare('DELETE FROM events WHERE expires_at < ?1').bind(t).run()
}
