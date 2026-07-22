import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings2, CheckCheck } from 'lucide-react'
import { api, AuthError, timeAgo, type EventItem, type ProjectRow } from '../lib/api'
import { Header, Container, LockedScreen, Spinner, Badge } from '../lib/shell'

export const Route = createFileRoute('/')({
  component: Inbox,
  ssr: false,
})

// Stable-ish accent per project name, so each project reads as its own color.
const PALETTE = ['#7c5cff', '#3fd08a', '#5c9cff', '#ffcc55', '#ff6b7a', '#c78bff', '#4dd8c0', '#ff9f6b']
function projectColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function Inbox() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [filter, setFilter] = useState<string | null>(null) // null = All; '' = No project
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')
  const sinceTs = useRef<number>(0)

  async function load(full = false) {
    try {
      const res = await api.feed(full ? undefined : sinceTs.current || undefined)
      if (res.events.length) {
        setEvents((prev) => {
          const map = new Map(prev.map((e) => [e.id, e]))
          for (const e of res.events) map.set(e.id, e)
          const merged = [...map.values()].sort((a, b) => b.created_at - a.created_at)
          sinceTs.current = Math.max(sinceTs.current, ...res.events.map((e) => e.updated_at))
          return merged
        })
      }
      // Refresh project counts alongside the feed (cheap, one grouped query).
      api.projects().then((p) => setProjects(p.projects)).catch(() => {})
      setState('ok')
    } catch (e) {
      if (e instanceof AuthError) setState('locked')
    }
  }

  useEffect(() => {
    load(true)
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

  const inFilter = (e: EventItem) =>
    filter === null ? true : (e.project ?? '') === filter
  const shown = events.filter(inFilter)
  const pending = shown.filter((e) => e.question?.status === 'pending')
  const rest = shown.filter((e) => e.question?.status !== 'pending')

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

      <FilterBar projects={projects} filter={filter} setFilter={setFilter} totalPending={events.filter((e) => e.question?.status === 'pending').length} />

      <Container>
        {pending.length > 0 && (
          <section style={{ marginBottom: '1.5rem' }}>
            <SectionTitle accent>Waiting on you · {pending.length}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {pending.map((e) => (
                <EventCard key={e.id} e={e} highlight />
              ))}
            </div>
          </section>
        )}

        <SectionTitle>History</SectionTitle>
        {rest.length === 0 && pending.length === 0 ? (
          <EmptyState filtered={filter !== null} />
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

function FilterBar({
  projects,
  filter,
  setFilter,
  totalPending,
}: {
  projects: ProjectRow[]
  filter: string | null
  setFilter: (v: string | null) => void
  totalPending: number
}) {
  // Sort: projects with pending first (already sorted server-side), keep '' last-ish.
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        gap: '0.5rem',
        overflowX: 'auto',
        padding: '0.7rem 1rem',
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        scrollbarWidth: 'none',
      }}
    >
      <Chip active={filter === null} onClick={() => setFilter(null)} label="All" dot={totalPending > 0} color="var(--accent)" />
      {projects.map((p) => (
        <Chip
          key={p.project || '__none__'}
          active={filter === p.project}
          onClick={() => setFilter(p.project)}
          label={p.project || 'No project'}
          dot={p.pending > 0}
          color={p.project ? projectColor(p.project) : 'var(--muted)'}
        />
      ))}
    </div>
  )
}

function Chip({ active, onClick, label, dot, color }: { active: boolean; onClick: () => void; label: string; dot: boolean; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        whiteSpace: 'nowrap',
        padding: '0.4rem 0.8rem',
        borderRadius: '999px',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 20%, var(--bg-elev))` : 'var(--bg-elev)',
        color: active ? '#fff' : 'var(--text)',
        fontSize: '0.85rem',
        fontWeight: 550,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: color, boxShadow: dot ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)` : 'none' }} />
      {label}
    </button>
  )
}

function SectionTitle({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <h2 style={{ fontSize: '0.75rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.06em', color: accent ? 'var(--accent)' : 'var(--muted)', margin: '0 0 0.6rem' }}>
      {children}
    </h2>
  )
}

function EventCard({ e, highlight }: { e: EventItem; highlight?: boolean }) {
  const unread = e.read_at == null
  const pColor = e.project ? projectColor(e.project) : 'var(--muted)'
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
        borderLeft: `3px solid ${highlight ? 'var(--accent)' : pColor}`,
        borderRadius: '0.75rem',
        padding: '0.85rem 1rem',
      }}
    >
      {/* Row 1: project · model · kind · time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        {e.project ? (
          <span style={{ fontSize: '0.72rem', fontWeight: 650, color: pColor, background: `color-mix(in srgb, ${pColor} 15%, transparent)`, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
            {e.project}
          </span>
        ) : null}
        {e.model ? (
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.12rem 0.45rem', borderRadius: '999px' }}>
            {e.model}
          </span>
        ) : null}
        <Badge kind={e.kind} />
        <span style={{ fontSize: '0.78rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
        {unread ? <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: 'var(--accent)' }} /> : null}
      </div>

      {/* Row 2: current task */}
      {e.task ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>
          <span style={{ opacity: 0.7 }}>Task:</span> {e.task}
        </div>
      ) : null}

      {/* Row 3: the message / question */}
      <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{e.title}</div>

      {/* Row 4: tags + agent */}
      {(e.tags.length > 0 || e.agent) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {e.tags.map((t) => (
            <span key={t} style={{ fontSize: '0.68rem', color: 'var(--muted)', background: 'var(--bg-elev2)', padding: '0.1rem 0.45rem', borderRadius: '0.3rem' }}>
              #{t}
            </span>
          ))}
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginLeft: e.tags.length ? 'auto' : 0 }}>{e.agent}</span>
        </div>
      )}

      {highlight ? <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>Tap to answer →</div> : null}
    </Link>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)' }}>
      {filtered ? (
        <p style={{ fontSize: '1rem' }}>Nothing in this project yet.</p>
      ) : (
        <>
          <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No messages yet.</p>
          <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
            Point an agent at this hub and it'll show up here. See{' '}
            <Link to="/settings">Settings</Link> for the connection snippet.
          </p>
        </>
      )}
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
