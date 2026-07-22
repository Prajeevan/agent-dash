import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings2, CheckCheck } from 'lucide-react'
import { api, AuthError, timeAgo, type EventItem } from '../lib/api'
import { Header, Container, LockedScreen, Spinner, Badge } from '../lib/shell'

export const Route = createFileRoute('/')({
  component: Inbox,
  ssr: false,
})

function Inbox() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')
  const sinceTs = useRef<number>(0)

  async function load(full = false) {
    try {
      const res = await api.feed(full ? undefined : sinceTs.current || undefined)
      if (res.events.length) {
        setEvents((prev) => {
          // Merge by id so an in-place update (e.g. a moving progress bar)
          // replaces the card's content while it keeps its position.
          const map = new Map(prev.map((e) => [e.id, e]))
          for (const e of res.events) map.set(e.id, e)
          const merged = [...map.values()].sort((a, b) => b.created_at - a.created_at)
          sinceTs.current = Math.max(sinceTs.current, ...res.events.map((e) => e.updated_at))
          return merged
        })
      }
      setState('ok')
    } catch (e) {
      if (e instanceof AuthError) setState('locked')
    }
  }

  useEffect(() => {
    load(true)
    // Poll only while the tab is visible — keeps us well under free limits.
    const tick = () => {
      if (document.visibilityState === 'visible') load(false)
    }
    const iv = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />

  const pending = events.filter((e) => e.question?.status === 'pending')
  const rest = events.filter((e) => e.question?.status !== 'pending')

  return (
    <>
      <Header
        live
        right={
          <>
            <button onClick={() => api.markAllRead().then(() => load(true))} title="Mark all read" style={iconBtn}>
              <CheckCheck size={18} />
            </button>
            <Link to="/settings" title="Settings" style={{ ...iconBtn, display: 'inline-flex' }}>
              <Settings2 size={18} />
            </Link>
          </>
        }
      />
      <Container>
        {pending.length > 0 && (
          <section style={{ marginBottom: '1.5rem' }}>
            <SectionTitle>Waiting on you</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {pending.map((e) => (
                <EventCard key={e.id} e={e} highlight />
              ))}
            </div>
          </section>
        )}

        <SectionTitle>{pending.length ? 'Recent' : 'Inbox'}</SectionTitle>
        {rest.length === 0 && pending.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {rest.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </Container>
    </>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: '0.75rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: '0 0 0.6rem' }}>
      {children}
    </h2>
  )
}

function EventCard({ e, highlight }: { e: EventItem; highlight?: boolean }) {
  const unread = e.read_at == null
  return (
    <Link
      to="/event/$id"
      params={{ id: e.id }}
      className="animate-in"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--text)',
        background: 'var(--bg-elev)',
        border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '0.75rem',
        padding: '0.85rem 1rem',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <Badge kind={e.kind} />
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{e.agent}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
        {unread ? <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: 'var(--accent)' }} /> : null}
      </div>
      <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{e.title}</div>
      {e.task_id ? <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>#{e.task_id}</div> : null}
      {highlight ? <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>Tap to answer →</div> : null}
    </Link>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)' }}>
      <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No messages yet.</p>
      <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
        Point an agent at this hub and it'll show up here. See{' '}
        <Link to="/settings">Settings</Link> for the connection snippet.
      </p>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  padding: '0.45rem',
  color: 'var(--text)',
  cursor: 'pointer',
  lineHeight: 0,
}
