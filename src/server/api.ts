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
    title: event.project ? `${event.project}: ${event.title}` : event.title,
    // Encrypted events carry ciphertext blocks the server can't read — the
    // notification stays generic; the app decrypts the detail on open.
    body: event.enc ? '🔒 Encrypted — open to view' : previewText(JSON.parse(event.blocks)),
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
  project: string | null
  enc: number
}

// Validate/normalize a blocks payload that may be plaintext (a JSON array we
// zod-check) or an encrypted ciphertext string (opaque; stored as-is). Returns
// the string to store + the enc flag, or an error Response.
function normalizeBlocks(
  body: Record<string, unknown>,
  { allowInteractive }: { allowInteractive: boolean },
): { blocks: string; enc: number } | Response {
  if (body.enc === true) {
    if (typeof body.blocks !== 'string' || !body.blocks) {
      return json({ ok: false, error: 'Encrypted events must send blocks as a ciphertext string.' }, 400)
    }
    return { blocks: body.blocks, enc: 1 }
  }
  const parsed = BlocksSchema.safeParse(body.blocks ?? [])
  if (!parsed.success) {
    return json({ ok: false, error: 'Invalid blocks.', detail: parsed.error.issues.slice(0, 5) }, 400)
  }
  if (!allowInteractive && hasInteractive(parsed.data)) {
    return json({ ok: false, error: 'Interactive blocks (buttons/form) are only valid on questions.' }, 400)
  }
  if (allowInteractive && !hasInteractive(parsed.data)) {
    return json({ ok: false, error: 'A question needs at least one interactive block (buttons or form).' }, 400)
  }
  return { blocks: JSON.stringify(parsed.data), enc: 0 }
}

// ── Agent endpoints (bearer AGENT_KEY) ───────────────────────────────────────

const VALID_KINDS = new Set(['update', 'question', 'done', 'error'])

interface Meta {
  project: string | null
  task: string | null
  model: string | null
  tags: string // JSON array string
}

// Pull the attribution fields out of a request body, sanitized.
function extractMeta(body: Record<string, unknown>): Meta {
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[])
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 12)
        .map((t) => (t as string).trim().slice(0, 40))
    : []
  return {
    project: str(body.project, 120),
    task: str(body.task, 200),
    model: str(body.model, 80),
    tags: JSON.stringify(tags),
  }
}

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

  const norm = normalizeBlocks(body, { allowInteractive: false })
  if (norm instanceof Response) return norm

  const meta = extractMeta(body)
  const id = ulid()
  const t = now()
  await env.DB.prepare(
    `INSERT INTO events (id, agent, task_id, kind, title, blocks, priority, created_at, updated_at, expires_at, project, task, model, tags, enc)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  )
    .bind(id, agent, taskId, kind, title, norm.blocks, priority, t, t + retentionMs(env), meta.project, meta.task, meta.model, meta.tags, norm.enc)
    .run()

  const event: EventRow = {
    id, agent, task_id: taskId, kind, title,
    blocks: norm.blocks, priority, created_at: t, read_at: null,
    expires_at: t + retentionMs(env), project: meta.project, enc: norm.enc,
  }
  await maybePush(env, event)
  return json({ ok: true, id })
}

// Patch an existing event in place — the primitive behind live progress. The
// agent POSTs the id it got back from createEvent, with new blocks/title/kind.
// Pushes only if the caller explicitly asks (avoid buzzing on every % tick).
export async function updateEvent(id: string, request: Request, env: Env): Promise<Response> {
  const existing = await env.DB.prepare(
    'SELECT id, agent, task_id, kind, priority FROM events WHERE id = ?1',
  )
    .bind(id)
    .first<{ id: string; agent: string; task_id: string | null; kind: string; priority: number }>()
  if (!existing) return json({ ok: false, error: 'Unknown event id.' }, 404)
  if (existing.kind === 'question') {
    return json({ ok: false, error: 'Questions cannot be updated in place.' }, 400)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  // Resolve the new values, falling back to the existing row where omitted.
  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 300) : null
  const kind =
    typeof body.kind === 'string' && VALID_KINDS.has(body.kind) && body.kind !== 'question'
      ? body.kind
      : null
  const priority =
    body.priority != null ? Math.max(0, Math.min(2, Number(body.priority) | 0)) : existing.priority

  let blocksJson: string | null = null
  let blocks: Block[] | null = null
  let encVal: number | null = null
  if (body.blocks != null) {
    const norm = normalizeBlocks(body, { allowInteractive: false })
    if (norm instanceof Response) return norm
    blocksJson = norm.blocks
    encVal = norm.enc
    if (norm.enc === 0) blocks = JSON.parse(norm.blocks) as Block[]
  }

  // Only overwrite meta fields the caller actually sent (COALESCE on null).
  const project = 'project' in body ? extractMeta(body).project : null
  const task = 'task' in body ? extractMeta(body).task : null
  const model = 'model' in body ? extractMeta(body).model : null
  const tags = 'tags' in body ? extractMeta(body).tags : null

  // COALESCE keeps the old value when we pass null. read_at resets so a fresh
  // update the human hasn't seen shows as unread again.
  await env.DB.prepare(
    `UPDATE events SET
       title = COALESCE(?1, title),
       kind = COALESCE(?2, kind),
       priority = ?3,
       blocks = COALESCE(?4, blocks),
       project = COALESCE(?5, project),
       task = COALESCE(?6, task),
       model = COALESCE(?7, model),
       tags = COALESCE(?8, tags),
       enc = COALESCE(?9, enc),
       updated_at = ?10,
       read_at = NULL
     WHERE id = ?11`,
  )
    .bind(title, kind, priority, blocksJson, project, task, model, tags, encVal, now(), id)
    .run()

  if (body.notify === true) {
    await pushToAll(env, {
      title: title ?? 'Update',
      body: encVal === 1 ? '🔒 Encrypted — open to view' : blocks ? previewText(blocks) : 'Progress updated.',
      tag: existing.task_id || id,
      eventId: id,
      kind: kind ?? existing.kind,
      priority,
    })
  }
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

  // Encrypted questions can't be validated server-side (the interactive block
  // is inside the ciphertext) — we trust the agent and enforce shape client-side.
  const norm = normalizeBlocks(body, { allowInteractive: true })
  if (norm instanceof Response) return norm

  const timeoutMin = Math.max(1, Math.min(10_080, Number(body.timeout_minutes ?? 1440) | 0)) // default 24h, max 7d
  const meta = extractMeta(body)
  const id = ulid()
  const t = now()
  const timeoutAt = t + timeoutMin * 60_000

  const batch = [
    env.DB.prepare(
      `INSERT INTO events (id, agent, task_id, kind, title, blocks, priority, created_at, updated_at, expires_at, project, task, model, tags, enc)
       VALUES (?1, ?2, ?3, 'question', ?4, ?5, 2, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(id, agent, taskId, title, norm.blocks, t, t + retentionMs(env), meta.project, meta.task, meta.model, meta.tags, norm.enc),
    env.DB.prepare(
      `INSERT INTO questions (event_id, status, timeout_at) VALUES (?1, 'pending', ?2)`,
    ).bind(id, timeoutAt),
  ]
  await env.DB.batch(batch)

  const event: EventRow = {
    id, agent, task_id: taskId, kind: 'question', title,
    blocks: norm.blocks, priority: 2, created_at: t, read_at: null,
    expires_at: t + retentionMs(env), project: meta.project, enc: norm.enc,
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
        `SELECT id, agent, task_id, kind, title, priority, created_at, project, task, model FROM events
         WHERE agent = ?1 ORDER BY created_at DESC LIMIT ?2`,
      ).bind(agent, limit)
    : env.DB.prepare(
        `SELECT id, agent, task_id, kind, title, priority, created_at, project, task, model FROM events
         ORDER BY created_at DESC LIMIT ?1`,
      ).bind(limit)
  const { results } = await q.all()
  return json({ ok: true, events: results ?? [] })
}

// Project cards for the landing page: which models are active, how many tasks
// need action, last activity. Sorted so projects needing you float to the top.
export async function getProjects(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       COALESCE(e.project, '') AS project,
       COUNT(*) AS total,
       SUM(CASE WHEN e.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
       SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       MAX(e.created_at) AS last_activity,
       GROUP_CONCAT(DISTINCT e.model) AS models
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     GROUP BY COALESCE(e.project, '')
     ORDER BY pending DESC, last_activity DESC`,
  ).all<{ project: string; total: number; unread: number; pending: number; last_activity: number; models: string | null }>()
  const projects = (results ?? []).map((r) => ({
    project: r.project,
    total: r.total,
    unread: r.unread,
    pending: r.pending,
    last_activity: r.last_activity,
    models: (r.models ?? '').split(',').filter(Boolean),
  }))
  return json({ ok: true, projects })
}

// The thread key: a stable task_id when the agent sent one, else the event's
// own id (a singleton thread). NEVER the human `task` label — labels collide.
const THREAD_KEY_SQL = `COALESCE(NULLIF(e.task_id, ''), e.id)`

// Task threads within a project. Groups events by thread key in JS (small,
// single-user data), summarizing each thread for the project view.
export async function getTasks(project: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT e.*, ${THREAD_KEY_SQL} AS thread_key,
       q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE COALESCE(e.project, '') = ?1
     ORDER BY e.created_at ASC`,
  )
    .bind(project)
    .all<Record<string, unknown>>()

  const threads = new Map<string, any>()
  for (const row of results ?? []) {
    const key = String(row.thread_key)
    let t = threads.get(key)
    if (!t) {
      t = {
        key,
        project,
        task: null,
        model: null,
        agent: null,
        count: 0,
        unread: 0,
        pending: false,
        pending_event_id: null,
        pending_question: null,
        latest_title: '',
        latest_kind: 'update',
        last_activity: 0,
      }
      threads.set(key, t)
    }
    t.count++
    if (row.task) t.task = row.task
    if (row.model) t.model = row.model
    if (row.agent) t.agent = row.agent
    if (row.read_at == null) t.unread++
    // Latest event (rows are ASC, so keep overwriting).
    t.latest_title = row.title
    t.latest_kind = row.kind
    t.last_activity = Math.max(t.last_activity, Number(row.updated_at ?? row.created_at))
    if (row.q_status === 'pending') {
      t.pending = true
      t.pending_event_id = row.id
      t.pending_question = row.title // what is being asked, shown on the card
    }
  }

  const list = [...threads.values()].sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1
    return b.last_activity - a.last_activity
  })
  return json({ ok: true, tasks: list })
}

// All events in one thread, oldest-first, so the thread view renders the
// conversation with the active question (if any) at the bottom.
export async function getThread(project: string, key: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE COALESCE(e.project, '') = ?1 AND ${THREAD_KEY_SQL} = ?2
     ORDER BY e.created_at ASC`,
  )
    .bind(project, key)
    .all()
  const events = (results ?? []).map(hydrate)
  if (events.length === 0) return json({ ok: false, error: 'Thread not found.' }, 404)
  // Prefer the most recent non-empty task label as the thread title.
  let task: unknown = null
  for (const e of events) if ((e as Record<string, unknown>).task) task = (e as Record<string, unknown>).task
  return json({ ok: true, thread: { key, project, task, events } })
}

// ── Dashboard endpoints (session cookie) ─────────────────────────────────────

// Timestamp-cursor feed for open dashboard tabs. `since_ts` is the newest
// updated_at the tab already has; we return anything created OR updated after
// it — so in-place progress updates flow through, not just brand-new events.
// Ordered by created_at so a card stays put while its progress bar moves.
export async function getFeed(url: URL, env: Env): Promise<Response> {
  const sinceTs = Number(url.searchParams.get('since_ts') ?? '0') || 0
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100') | 0))
  const rows = await env.DB.prepare(
    `SELECT e.*, q.status AS q_status, q.answer AS q_answer, q.timeout_at AS q_timeout
     FROM events e LEFT JOIN questions q ON q.event_id = e.id
     WHERE COALESCE(e.updated_at, e.created_at) > ?1
     ORDER BY e.created_at DESC LIMIT ?2`,
  )
    .bind(sinceTs, limit)
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
  const enc = Number(row.enc ?? 0) === 1
  // Encrypted rows carry ciphertext strings the server can't parse — pass them
  // through untouched; the client decrypts. Plaintext rows are JSON.
  const blocks = enc ? (row.blocks as string) : JSON.parse((row.blocks as string) || '[]')
  const answer = row.q_answer
    ? enc
      ? (row.q_answer as string)
      : JSON.parse(row.q_answer as string)
    : null
  return {
    id: row.id,
    agent: row.agent,
    task_id: row.task_id,
    kind: row.kind,
    title: row.title,
    blocks,
    enc,
    priority: row.priority,
    project: row.project ?? null,
    task: row.task ?? null,
    model: row.model ?? null,
    tags: JSON.parse((row.tags as string) || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    read_at: row.read_at,
    question:
      row.q_status != null
        ? { status: row.q_status, answer, timeout_at: row.q_timeout }
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

// Bring an item back to the top by marking it unread again.
export async function markUnread(id: string, env: Env): Promise<Response> {
  await env.DB.prepare('UPDATE events SET read_at = NULL WHERE id = ?1').bind(id).run()
  return json({ ok: true })
}

// Clear the inbox. scope:
//   'read'    — only items already seen/answered (safe default; keeps unread + pending)
//   'all'     — everything, including unanswered questions (a full restart)
// Optionally scoped to a single project.
export async function clearEvents(
  env: Env,
  scope: 'read' | 'all',
  project?: string | null,
): Promise<Response> {
  const projFilter = project != null ? `COALESCE(project, '') = ?1` : null
  const bind = project != null ? [project] : []

  let where: string
  if (scope === 'all') {
    where = projFilter ?? '1=1'
  } else {
    where = projFilter ? `read_at IS NOT NULL AND ${projFilter}` : 'read_at IS NOT NULL'
  }

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`)
    .bind(...bind)
    .first<{ n: number }>()

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM questions WHERE event_id IN (SELECT id FROM events WHERE ${where})`).bind(...bind),
    env.DB.prepare(`DELETE FROM events WHERE ${where}`).bind(...bind),
  ])
  return json({ ok: true, cleared: countRow?.n ?? 0 })
}

// You answer a question in the UI. Validate the answer against the question's
// own interactive blocks so a stale/garbage submit can't land.
export async function answerQuestion(id: string, request: Request, env: Env): Promise<Response> {
  const event = await env.DB.prepare('SELECT blocks, enc FROM events WHERE id = ?1 AND kind = ?2')
    .bind(id, 'question')
    .first<{ blocks: string; enc: number }>()
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

  // Encrypted question: the answer arrives as a ciphertext string the server
  // can't (and shouldn't) validate. Store it opaquely for the agent to decrypt.
  if (event.enc === 1) {
    if (submitted.enc !== true || typeof submitted.answer !== 'string' || !submitted.answer) {
      return json({ ok: false, error: 'Encrypted questions need an encrypted answer.' }, 400)
    }
    await env.DB.prepare(
      `UPDATE questions SET status = 'answered', answer = ?1, answered_at = ?2 WHERE event_id = ?3`,
    )
      .bind(submitted.answer, now(), id)
      .run()
    await env.DB.prepare('UPDATE events SET read_at = COALESCE(read_at, ?1) WHERE id = ?2')
      .bind(now(), id)
      .run()
    return json({ ok: true })
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
