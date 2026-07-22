import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { api, AuthError, timeAgo, type ThreadData, type EventItem } from '../lib/api'
import { Header, Container, LockedScreen, Spinner } from '../lib/shell'
import { BlockRenderer, AnswerForm } from '../lib/blocks'
import { projectColor, projectLabel, fromParam, KIND_LABEL, KIND_COLOR } from '../lib/project'
import { getEncKey, encryptValue, decryptValue } from '../lib/e2e'
import { useLive } from '../lib/live'

export const Route = createFileRoute('/project/$name/task/$key')({
  component: ThreadView,
  ssr: false,
})

function ThreadView() {
  const { name, key } = useParams({ from: '/project/$name/task/$key' })
  const project = fromParam(name)
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'locked' | 'notfound'>('loading')
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const markedRead = useRef(false)

  async function load() {
    try {
      const res = await api.thread(project, key)
      if (!res.ok || !res.thread) {
        setState('notfound')
        return
      }
      setThread(res.thread)
      setState('ok')
      // Mark non-pending unread events read once (pending questions stay unread
      // until answered, so they keep surfacing in "Waiting on you").
      if (!markedRead.current) {
        markedRead.current = true
        for (const e of res.thread.events) {
          if (e.read_at == null && e.question?.status !== 'pending') api.markRead(e.id).catch(() => {})
        }
      }
    } catch (e) {
      if (e instanceof AuthError) setState('locked')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key])
  useLive(load)

  async function submit(eventId: string, answer: Record<string, unknown>) {
    setSubmitting(eventId)
    setError(null)
    try {
      const res = await api.answer(eventId, answer)
      if (!res.ok) {
        setError(res.error ?? 'Could not submit.')
        setSubmitting(null)
        return
      }
      await load()
    } catch {
      setError('Could not submit.')
    }
    setSubmitting(null)
  }

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />
  if (state === 'notfound' || !thread)
    return (
      <Container>
        <p style={{ color: 'var(--muted)', padding: '2rem 0' }}>This task no longer exists.</p>
        <Link to="/">← Back to projects</Link>
      </Container>
    )

  const color = projectColor(project)
  const title = thread.task || thread.events[0]?.title || 'Task'

  return (
    <>
      <Header
        right={
          <Link to="/project/$name" params={{ name }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
            <ArrowLeft size={16} /> {projectLabel(project)}
          </Link>
        }
      />
      <Container>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
          <span style={{ width: '0.6rem', height: '0.6rem', borderRadius: '999px', background: color }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{projectLabel(project)}</span>
        </div>
        <h1 style={{ fontSize: '1.4rem', lineHeight: 1.3, margin: '0 0 1.3rem' }}>{title}</h1>

        {/* The conversation: each message/question in order. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {thread.events.map((e) => (
            <Message
              key={e.id}
              e={e}
              submitting={submitting === e.id}
              error={submitting === null && error != null && e.question?.status === 'pending' ? error : null}
              onSubmit={(a) => submit(e.id, a)}
            />
          ))}
        </div>
      </Container>
    </>
  )
}

function Message({ e, submitting, error, onSubmit }: { e: EventItem; submitting: boolean; error: string | null; onSubmit: (a: Record<string, unknown>) => void }) {
  const q = e.question
  const isPending = q?.status === 'pending'

  // Decrypt block content (and any answer) locally when the event is E2E.
  const [dec, setDec] = useState<{ blocks: unknown[]; answer: unknown } | null>(null)
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (!e.enc) {
      setDec({ blocks: e.blocks as unknown[], answer: q?.answer ?? null })
      return
    }
    const key = getEncKey()
    if (!key) {
      setLocked(true)
      return
    }
    ;(async () => {
      try {
        const blocks = await decryptValue<unknown[]>(key, e.blocks as string)
        let answer: unknown = null
        if (q?.answer && typeof q.answer === 'string') answer = await decryptValue(key, q.answer)
        setDec({ blocks, answer })
        setLocked(false)
      } catch {
        setLocked(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.enc, typeof e.blocks === 'string' ? e.blocks : '', typeof q?.answer === 'string' ? q?.answer : ''])

  // For E2E questions, encrypt the answer before it leaves the device.
  async function handleSubmit(a: Record<string, unknown>) {
    if (!e.enc) return onSubmit(a)
    const key = getEncKey()
    if (!key) return
    const cipher = await encryptValue(key, a)
    onSubmit({ enc: true, answer: cipher })
  }

  const blocks = dec?.blocks ?? []
  const answer = dec?.answer ?? null

  if (locked) {
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', color: 'var(--muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: KIND_COLOR[e.kind] }}>{KIND_LABEL[e.kind]}</span>
          <span style={{ fontSize: '0.76rem', color: 'var(--faint)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
        </div>
        {e.title ? <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{e.title}</div> : null}
        🔒 Encrypted. Add your key in <Link to="/settings" style={{ color: 'var(--accent-2)' }}>Settings → Encryption</Link> to read it.
      </div>
    )
  }
  return (
    <div
      style={{
        background: isPending
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 9%, var(--bg-elev)), var(--bg-elev))'
          : 'var(--bg-elev)',
        border: `1px solid ${isPending ? 'color-mix(in srgb, var(--accent) 40%, var(--border))' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '1rem',
        boxShadow: isPending ? 'var(--shadow-glow)' : 'var(--shadow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: KIND_COLOR[e.kind], background: `color-mix(in srgb, ${KIND_COLOR[e.kind]} 15%, transparent)`, padding: '0.12rem 0.5rem', borderRadius: '999px' }}>
          {KIND_LABEL[e.kind] ?? 'Event'}
        </span>
        {e.model ? <span style={{ fontSize: '0.71rem', color: 'var(--muted)' }}>{e.model}</span> : null}
        <span style={{ fontSize: '0.76rem', color: 'var(--faint)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
      </div>

      {e.title ? <div style={{ fontWeight: 600, marginBottom: '0.6rem', lineHeight: 1.4 }}>{e.title}</div> : null}

      {e.enc ? <span style={{ fontSize: '0.7rem', color: 'var(--success)', marginBottom: '0.5rem', display: 'inline-block' }}>🔒 end-to-end encrypted</span> : null}

      <BlockRenderer blocks={blocks} />

      {q && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          {isPending ? (
            <>
              <AnswerForm blocks={blocks} disabled={submitting} onSubmit={handleSubmit} />
              {error ? <p style={{ color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.8rem' }}>{error}</p> : null}
            </>
          ) : q.status === 'answered' ? (
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.6rem' }}>
                ✓ You answered
              </div>
              <pre style={{ margin: '0 0 0.7rem', background: 'var(--bg-elev2)', padding: '0.7rem', borderRadius: '0.5rem', fontSize: '0.8rem', overflowX: 'auto', color: 'var(--muted)' }}>
                <code>{formatAnswer(answer)}</code>
              </pre>
              {q.picked_up_at ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>
                    ✓✓ Agent received it · {timeAgo(q.picked_up_at)}
                  </div>
                  {e.ack ? (
                    <div style={{ borderLeft: '3px solid var(--success)', background: 'var(--bg-elev2)', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
                      {e.ack.replace(/\{answer\}/g, shortAnswer(answer))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: 'var(--warn)', fontSize: '0.82rem' }}>
                  <span className="live-dot" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: 'var(--warn)' }} />
                  Waiting for the agent to receive your answer…
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--warn)', fontSize: '0.88rem' }}>Expired before you answered.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Short inline form for the ack's {answer} placeholder, e.g. "Ocean" or
// "audience: VC, tone: Punchy".
function shortAnswer(answer: unknown): string {
  if (answer == null) return ''
  if (typeof answer !== 'object') return String(answer)
  const parts: string[] = []
  for (const v of Object.values(answer)) {
    if (v && typeof v === 'object') for (const fv of Object.values(v as Record<string, unknown>)) parts.push(String(fv))
    else parts.push(String(v))
  }
  return parts.join(', ')
}

function formatAnswer(answer: unknown): string {
  if (!answer || typeof answer !== 'object') return answer ? String(answer) : ''
  // Flatten { blockId: value | {field: value} } into readable lines.
  const lines: string[] = []
  for (const v of Object.values(answer)) {
    if (v && typeof v === 'object') {
      for (const [fk, fv] of Object.entries(v as Record<string, unknown>)) lines.push(`${fk}: ${fv}`)
    } else {
      lines.push(String(v))
    }
  }
  return lines.join('\n')
}
