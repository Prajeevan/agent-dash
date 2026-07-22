import { useEffect, useState } from 'react'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { api, AuthError, timeAgo, type EventItem } from '../lib/api'
import { Header, Container, LockedScreen, Spinner, Badge } from '../lib/shell'
import { BlockRenderer, AnswerForm } from '../lib/blocks'

export const Route = createFileRoute('/event/$id')({
  component: EventDetail,
  ssr: false,
})

function EventDetail() {
  const { id } = useParams({ from: '/event/$id' })
  const [event, setEvent] = useState<EventItem | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'locked' | 'notfound'>('loading')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await api.event(id)
      if (!res.ok || !res.event) {
        setState('notfound')
        return
      }
      setEvent(res.event)
      setState('ok')
      if (res.event.read_at == null) api.markRead(id).catch(() => {})
    } catch (e) {
      if (e instanceof AuthError) setState('locked')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // If it's an unanswered question, keep it fresh in case it's answered/expired elsewhere.
  useEffect(() => {
    if (event?.question?.status !== 'pending') return
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.question?.status])

  async function submit(answer: Record<string, unknown>) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.answer(id, answer)
      if (!res.ok) {
        setError(res.error ?? 'Could not submit.')
        setSubmitting(false)
        return
      }
      await load()
    } catch {
      setError('Could not submit.')
    }
    setSubmitting(false)
  }

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />
  if (state === 'notfound' || !event)
    return (
      <Container>
        <p style={{ color: 'var(--muted)', padding: '2rem 0' }}>This message no longer exists.</p>
        <Link to="/">← Back to inbox</Link>
      </Container>
    )

  const q = event.question
  const isPendingQuestion = q?.status === 'pending'

  return (
    <>
      <Header
        right={
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
            <ArrowLeft size={16} /> Inbox
          </Link>
        }
      />
      <Container>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Badge kind={event.kind} />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{event.agent}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(event.created_at)}</span>
        </div>
        <h1 style={{ fontSize: '1.35rem', lineHeight: 1.3, margin: '0 0 1.2rem' }}>{event.title}</h1>

        <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '0.9rem', padding: '1.1rem' }}>
          <BlockRenderer blocks={event.blocks} />

          {q && (
            <div style={{ marginTop: '1.3rem', paddingTop: '1.3rem', borderTop: '1px solid var(--border)' }}>
              {isPendingQuestion ? (
                <>
                  <AnswerForm blocks={event.blocks} disabled={submitting} onSubmit={submit} />
                  {error ? <p style={{ color: 'var(--error)', fontSize: '0.85rem', marginTop: '0.8rem' }}>{error}</p> : null}
                  <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '1rem' }}>
                    The agent is polling for your answer and will continue as soon as you respond.
                  </p>
                </>
              ) : q.status === 'answered' ? (
                <AnsweredView answer={q.answer} />
              ) : (
                <div style={{ color: 'var(--warn)', fontSize: '0.9rem' }}>
                  This question expired before it was answered. The agent will have proceeded with a default.
                </div>
              )}
            </div>
          )}
        </div>
      </Container>
    </>
  )
}

function AnsweredView({ answer }: { answer: Record<string, unknown> | null }) {
  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.8rem' }}>
        ✓ Answered
      </div>
      <pre style={{ margin: 0, background: 'var(--bg-elev2)', padding: '0.8rem', borderRadius: '0.5rem', fontSize: '0.82rem', overflowX: 'auto', color: 'var(--muted)' }}>
        <code>{JSON.stringify(answer, null, 2)}</code>
      </pre>
    </div>
  )
}
