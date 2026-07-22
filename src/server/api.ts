import type { Env } from './env'
import { json, ulid, now } from './util'
import { BlocksSchema, hasInteractive, answerTargets, type Block } from './blocks'
import { pushToAll, type PushSubscription } from './push'

// ── retention / settings helpers ─────────────────────────────────────────────
function retentionMs(env: Env): number {
  const days = Number(env.EVENT_RETENTION_DAYS ?? '30')
  return Math.max(1, days) * 86_400_000
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1')
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, value)
    .run()
}

// Quiet hours: suppress non-urgent push between start/end (minutes since UTC
// midnight, offset by the user's saved tz). Urgent (priority 2) always rings.
async function inQuietHours(env: Env): Promise<boolean> {
  const raw = await getSetting(env, 'quiet_hours')
  if (!raw) return false
  try {
    const { start, end, offsetMin } = JSON.parse(raw) as {
      start: number
      end: number
      offsetMin: number
    }
    if (start === end) return false
    const local = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + (offsetMin ?? 0) + 1440) % 1440
    return start < end ? local >= start && local < end : local >= start || local < end
  } catch {
    return false
  }
}

async function maybePush(env: Env, event: EventRow): Promise<void> {
  const wants = event.kind === 'question' || event.priority >= 1
  if (!wants) return
  if (event.priority < 2 && (await inQuietHours(env))) return
  await pushToAll(env, {
    title: event.title,
    body: previewText(JSON.parse(event.blocks)),
    tag: event.task_id || event.id,
    eventId: event.id,
    kind: event.kind,
    priority: event.priority,
  })
}

// A short plaintext preview for the notification body.
function previewText(blocks: Block[]): string {
  for (const b of blocks) {
    if (b.type === 'markdown') return b.text.replace(/[#*`_>]/g, '').slice(0, 140)
    if (b.type === 'callout') return b.text.slice(0, 140)
    if (b.type === 'keyvalue' && b.items[0]) return `${b.items[0].k}: ${b.items[0].v}`
  }
  return 'Open Agent Dash to see the details.'
}

interface EventRow {
  id: string
  agent: string
  task_id: string | null
  kind: string
  title: string
  blocks: string
  priority: number
  created_at: number
  read_at: number | null
  expires_at: number
}

// ── Agent endpoints (bearer AGENT_KEY) ───────────────────────────────────────

const VALID_KINDS = new Set(['update', 'question', 'done', 'error'])

export async function createEvent(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) return json({ ok: false, error: 'title is required.' }, 400)

  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 120) : 'agent'
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim().slice(0, 120) : null
  let kind = typeof body.kind === 'string' ? body.kind : 'update'
  if (!VALID_KINDS.has(kind)) kind = 'update'
  if (kind === 'question') return json({ ok: false, error: 'Use POST /questions to ask a question.' }, 400)

  const priority = Math.max(0, Math.min(2, Number(body.priority ?? 0) | 0))

  const parsed = BlocksSchema.safeParse(body.blocks ?? [])
  if (!parsed.success) {
    return json({ ok: false, error: 'Invalid blocks.', detail: parsed.error.issues.slice(0, 5) }, 400)
  }
  if (hasInteractive(parsed.data)) {
    return json({ ok: false, error: 'Interactive blocks (buttons/form) are only valid on questions.' }, 400)
  }

  const id = ulid()
  const t = now()
  await env.DB.prepare(
    `INSERT INTO events (id, agent, task_id, kind, title, blocks, priority, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(id, agent, taskId, kind, title, JSON.stringify(parsed.data), priority, t, t + retentionMs(env))
    .run()

  const event: EventRow = {
    id, agent, task_id: taskId, kind, title,
    blocks: JSON.stringify(parsed.data), priority, created_at: t, read_at: null,
    expires_at: t + retentionMs(env),
  }
  await maybePush(env, event)
  return json({ ok: true, id })
}

export async function createQuestion(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) return json({ ok: false, error: 'title is required.' }, 400)

  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 120) : 'agent'
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim().slice(0, 120) : null

  const parsed = BlocksSchema.safeParse(body.blocks ?? [])
  if (!parsed.success) {
    return json({ ok: false, error: 'Invalid blocks.', detail: parsed.error.issues.slice(0, 5) }, 400)
  }
  if (!hasInteractive(parsed.data)) {
    return json(
      { ok: false, error: 'A question needs at least one interactive block (buttons or form).' },
      400,
    )
  }

  const timeoutMin = Math.max(1, Math.min(10_080, Number(body.timeout_minutes ?? 1440) | 0)) // default 24h, max 7d
  const id = ulid()
  const t = now()
  const timeoutAt = t + timeoutMin * 60_000

  const batch = [
    env.DB.prepare(
      `INSERT INTO events (id, agent, task_id, kind, title, blocks, priority, created_at, expires_at)
       VALUES (?1, ?2, ?3, 'question', ?4, ?5, 2, ?6, ?7)`,
    ).bind(id, agent, taskId, title, JSON.stringify(parsed.data), t, t + retentionMs(env)),
    env.DB.prepare(
      `INSERT INTO questions (event_id, status, timeout_at) VALUES (?1, 'pending', ?2)`,
    ).bind(id, timeoutAt),
  ]
  await env.DB.batch(batch)

  const event: EventRow = {
    id, agent, task_id: taskId, kind: 'question', title,
    blocks: JSON.stringify(parsed.data), priority: 2, created_at: t, read_at: null,
    expires_at: t + retentionMs(env),
  }
  await maybePush(env, event)
  return json({ ok: true, id, poll_url: `/api/v1/questions/${id}`, timeout_at: timeoutAt })
}

// Agent polls this. Also lazily expires the question if its deadline passed, so
// a waiting agent gets a definitive answer instead of hanging forever.
export async function getQuestion(id: string, env: Env): Promise<Response> {
  const q = await env.DB.prepare(
    `SELECT status, answer, answered_at, timeout_at FROM questions WHERE event_id = ?1`,
  )
    .bind(id)
    .first<{ status: string; answer: string | null; answered_at: number | null; timeout_at: number }>()

  if (!q) return json({ ok: false, error: 'Unknown question id.' }, 404)

  if (q.status === 'pending' && q.timeout_at < now()) {
    await env.DB.prepare(`UPDATE questions SET status = 'expired' WHERE event_id = ?1`).bind(id).run()
    return json({ ok: true, status: 'expired' })
  }

  return json({
    ok: true,
    status: q.status,
    answer: q.answer ? JSON.parse(q.answer) : null,
    answered_at: q.answered_at,
  })
}

// Agent reads its recent events (dedupe / resume after a crash).
export async function getInbox(url: URL, env: Env): Promise<Response> {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? '30') | 0))
  const agent = url.searchParams.get('agent')
  const q = agent
    ? env.DB.prepare(
        `SELECT id, agent, task_id, kind, title, priority, created_at FROM events
         WHERE agent = ?1 ORDER BY created_at DESC LIMIT ?2`,
      ).bind(agent, limit)
    : env.DB.prepare(
        `SELECT id, agent, task_id, kind, title, priority, created_at FROM events
         ORDER BY created_at DESC LIMIT ?1`,
      ).bind(limit)
  const { results } = await q.all()
  return json({ ok: true, events: results ?? [] })
}

// ── Dashboard endpoints (session cookie) ─────────────────────────────────────

// Cursor-based feed for open dashboard tabs. `since` is the newest id the tab
// already has; returns anything strictly newer (ULIDs sort by time).
export async function getFeed(url: URL, env: Env): Promise<Response> {
  const since = url.searchParams.get('since')
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100') | 0))
  const rows = since
    ? await env.DB.prepare(
        `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
         FROM events e LEFT JOIN questions q ON q.event_id = e.id
         WHERE e.id > ?1 ORDER BY e.created_at DESC LIMIT ?2`,
      )
        .bind(since, limit)
        .all()
    : await env.DB.prepare(
        `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
         FROM events e LEFT JOIN questions q ON q.event_id = e.id
         ORDER BY e.created_at DESC LIMIT ?1`,
      )
        .bind(limit)
        .all()
  return json({ ok: true, events: (rows.results ?? []).map(hydrate) })
}

export async function getEvent(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
     FROM events e LEFT JOIN questions q ON q.event_id = e.id WHERE e.id = ?1`,
  )
    .bind(id)
    .first()
  if (!row) return json({ ok: false, error: 'Not found.' }, 404)
  return json({ ok: true, event: hydrate(row) })
}

function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    agent: row.agent,
    task_id: row.task_id,
    kind: row.kind,
    title: row.title,
    blocks: JSON.parse((row.blocks as string) || '[]'),
    priority: row.priority,
    created_at: row.created_at,
    read_at: row.read_at,
    question:
      row.q_status != null
        ? {
            status: row.q_status,
            answer: row.q_answer ? JSON.parse(row.q_answer as string) : null,
            timeout_at: row.q_timeout,
          }
        : null,
  }
}

export async function markRead(id: string, env: Env): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = ?1 WHERE id = ?2 AND read_at IS NULL')
    .bind(now(), id)
    .run()
  return json({ ok: true })
}

export async function markAllRead(env: Env): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = ?1 WHERE read_at IS NULL').bind(now()).run()
  return json({ ok: true })
}

// You answer a question in the UI. Validate the answer against the question's
// own interactive blocks so a stale/garbage submit can't land.
export async function answerQuestion(id: string, request: Request, env: Env): Promise<Response> {
  const event = await env.DB.prepare('SELECT blocks FROM events WHERE id = ?1 AND kind = ?2')
    .bind(id, 'question')
    .first<{ blocks: string }>()
  if (!event) return json({ ok: false, error: 'Unknown question.' }, 404)

  const q = await env.DB.prepare('SELECT status FROM questions WHERE event_id = ?1')
    .bind(id)
    .first<{ status: string }>()
  if (!q) return json({ ok: false, error: 'Unknown question.' }, 404)
  if (q.status !== 'pending') return json({ ok: false, error: `Question already ${q.status}.` }, 409)

  let submitted: Record<string, unknown>
  try {
    submitted = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }

  const blocks = JSON.parse(event.blocks) as Block[]
  const targets = answerTargets(blocks)
  const answer: Record<string, unknown> = {}

  for (const bId of targets.buttons) {
    if (typeof submitted[bId] === 'string') answer[bId] = submitted[bId]
  }
  for (const form of targets.forms) {
    const raw = submitted[form.id]
    if (raw && typeof raw === 'object') {
      const clean: Record<string, unknown> = {}
      for (const fId of form.fieldIds) {
        if (fId in (raw as Record<string, unknown>)) clean[fId] = (raw as Record<string, unknown>)[fId]
      }
      answer[form.id] = clean
    }
  }

  if (Object.keys(answer).length === 0) {
    return json({ ok: false, error: 'Answer did not match any of the question fields.' }, 400)
  }

  await env.DB.prepare(
    `UPDATE questions SET status = 'answered', answer = ?1, answered_at = ?2 WHERE event_id = ?3`,
  )
    .bind(JSON.stringify(answer), now(), id)
    .run()
  await env.DB.prepare('UPDATE events SET read_at = COALESCE(read_at, ?1) WHERE id = ?2')
    .bind(now(), id)
    .run()
  return json({ ok: true })
}

// ── Push subscription management (session) ───────────────────────────────────
export async function subscribePush(request: Request, env: Env): Promise<Response> {
  let sub: PushSubscription
  try {
    sub = (await request.json()) as PushSubscription
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return json({ ok: false, error: 'Malformed subscription.' }, 400)
  }
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, keys, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys`,
  )
    .bind(ulid(), sub.endpoint, JSON.stringify(sub.keys), now())
    .run()
  return json({ ok: true })
}

export async function unsubscribePush(request: Request, env: Env): Promise<Response> {
  let body: { endpoint?: string }
  try {
    body = (await request.json()) as { endpoint?: string }
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if (body.endpoint) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(body.endpoint).run()
  }
  return json({ ok: true })
}

// ── Settings (session) ───────────────────────────────────────────────────────
export async function getSettings(env: Env): Promise<Response> {
  const quiet = await getSetting(env, 'quiet_hours')
  return json({ ok: true, quiet_hours: quiet ? JSON.parse(quiet) : null })
}

export async function putSettings(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400)
  }
  if ('quiet_hours' in body) {
    await setSetting(env, 'quiet_hours', JSON.stringify(body.quiet_hours ?? null))
  }
  return getSettings(env)
}

export async function getStats(env: Env): Promise<Response> {
  const unread = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE read_at IS NULL')
    .first<{ n: number }>()
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM questions WHERE status = 'pending'`)
    .first<{ n: number }>()
  return json({ ok: true, unread: unread?.n ?? 0, pending_questions: pending?.n ?? 0 })
}
