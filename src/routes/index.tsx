import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings2, CheckCheck, Trash2 } from 'lucide-react'
import { api, AuthError, timeAgo, type EventItem, type ProjectRow } from '../lib/api'
import { Header, Container, LockedScreen, Spinner } from '../lib/shell'

export const Route = createFileRoute('/')({
  component: Inbox,
  ssr: false,
})

// Refined, harmonious per-project accents.
const PALETTE = ['#8b6dff', '#4ec7a8', '#5b9bff', '#f2b34d', '#ff7a92', '#c78bff', '#4dd0d8', '#ff9d6b']
function projectColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const KIND_LABEL: Record<string, string> = { update: 'Update', question: 'Question', done: 'Done', error: 'Error' }
const KIND_COLOR: Record<string, string> = { update: 'var(--info)', question: 'var(--accent)', done: 'var(--success)', error: 'var(--error)' }

function Inbox() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [filter, setFilter] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')
  const [clearOpen, setClearOpen] = useState(false)
  const sinceTs = useRef<number>(0)

  async function doClear(scope: 'read' | 'all') {
    setClearOpen(false)
    await api.clear(scope, filter).catch(() => {})
    // Drop cleared items locally, then hard-refresh from the server.
    sinceTs.current = 0
    setEvents([])
    await load(true)
  }

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

  const inFilter = (e: EventItem) => (filter === null ? true : (e.project ?? '') === filter)
  const shown = events.filter(inFilter)

  // Three tiers:
  //  • Waiting on you  — pending questions (always primary, full colour)
  //  • Recent          — the latest 3 unread, non-pending events (full colour)
  //  • History         — everything else: answered, viewed, or older (monotone)
  const pending = shown.filter((e) => e.question?.status === 'pending')
  const nonPending = shown.filter((e) => e.question?.status !== 'pending')
  const recent = nonPending.filter((e) => e.read_at == null).slice(0, 3)
  const recentIds = new Set(recent.map((e) => e.id))
  const history = nonPending.filter((e) => !recentIds.has(e.id))

  return (
    <>
      <Header
        live
        right={
          <>
            <button onClick={() => api.markAllRead().then(() => load(true))} title="Mark all read" style={iconBtn}>
              <CheckCheck size={18} />
            </button>
            <button onClick={() => setClearOpen((v) => !v)} title="Clear" style={{ ...iconBtn, color: clearOpen ? 'var(--error)' : 'var(--text)' }}>
              <Trash2 size={18} />
            </button>
            <Link to="/settings" title="Settings" style={{ ...iconBtn, display: 'inline-flex' }}>
              <Settings2 size={18} />
            </Link>
          </>
        }
      />

      <FilterBar
        projects={projects}
        filter={filter}
        setFilter={setFilter}
        totalPending={events.filter((e) => e.question?.status === 'pending').length}
      />

      <Container>
        {clearOpen && (
          <ClearPanel
            scopeLabel={filter === null ? 'all projects' : filter === '' ? '“No project”' : `“${filter}”`}
            onClear={doClear}
            onCancel={() => setClearOpen(false)}
          />
        )}
        {pending.length > 0 && (
          <Section title={`Waiting on you · ${pending.length}`} accent>
            {pending.map((e) => (
              <EventCard key={e.id} e={e} variant="pending" />
            ))}
          </Section>
        )}

        {recent.length > 0 && (
          <Section title="Recent">
            {recent.map((e) => (
              <EventCard key={e.id} e={e} variant="active" />
            ))}
          </Section>
        )}

        {history.length > 0 && (
          <Section title={`History · ${history.length}`} muted>
            {history.map((e) => (
              <EventCard key={e.id} e={e} variant="mono" />
            ))}
          </Section>
        )}

        {pending.length + recent.length + history.length === 0 && (
          <EmptyState filtered={filter !== null} />
        )}
      </Container>
    </>
  )
}

function ClearPanel({ scopeLabel, onClear, onCancel }: { scopeLabel: string; onClear: (s: 'read' | 'all') => void; onCancel: () => void }) {
  return (
    <div
      className="animate-in"
      style={{
        marginBottom: '1.2rem',
        padding: '1rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elev)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: '0.25rem' }}>Clear {scopeLabel}</div>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 0.9rem' }}>
        Choose how much to remove. This can’t be undone.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => onClear('read')} style={panelBtn(false)}>
          Read &amp; answered
        </button>
        <button onClick={() => onClear('all')} style={{ ...panelBtn(false), color: 'var(--error)', borderColor: 'var(--error)' }}>
          Everything
        </button>
        <button onClick={onCancel} style={{ ...panelBtn(false), marginLeft: 'auto', color: 'var(--muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function panelBtn(primary: boolean): React.CSSProperties {
  return {
    padding: '0.55rem 0.95rem',
    borderRadius: '0.55rem',
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg-elev2)',
    color: primary ? '#fff' : 'var(--text)',
    fontWeight: 600,
    fontSize: '0.88rem',
    cursor: 'pointer',
  }
}

function Section({ title, accent, muted, children }: { title: string; accent?: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '1.6rem' }}>
      <h2
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: accent ? 'var(--accent-2)' : muted ? 'var(--faint)' : 'var(--muted)',
          margin: '0 0 0.7rem',
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>{children}</div>
    </section>
  )
}

function FilterBar({ projects, filter, setFilter, totalPending }: { projects: ProjectRow[]; filter: string | null; setFilter: (v: string | null) => void; totalPending: number }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        gap: '0.45rem',
        overflowX: 'auto',
        padding: '0.7rem 1rem',
        borderBottom: '1px solid var(--border-soft)',
        background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
        backdropFilter: 'blur(14px)',
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
          color={p.project ? projectColor(p.project) : 'var(--faint)'}
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
        padding: '0.42rem 0.85rem',
        borderRadius: '999px',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 22%, var(--bg-elev))` : 'var(--bg-elev)',
        color: active ? '#fff' : 'var(--muted)',
        fontSize: '0.84rem',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all .15s',
      }}
    >
      <span
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '999px',
          background: color,
          boxShadow: dot ? `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)` : 'none',
        }}
      />
      {label}
    </button>
  )
}

type Variant = 'pending' | 'active' | 'mono'

function EventCard({ e, variant }: { e: EventItem; variant: Variant }) {
  const mono = variant === 'mono'
  const pending = variant === 'pending'
  const unread = e.read_at == null
  const pColor = mono ? 'var(--border)' : e.project ? projectColor(e.project) : 'var(--faint)'
  const accent = pending ? 'var(--accent)' : pColor

  return (
    <Link
      to="/event/$id"
      params={{ id: e.id }}
      className="animate-in"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--text)',
        background: pending
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--bg-elev)), var(--bg-elev))'
          : 'var(--bg-elev)',
        border: `1px solid ${pending ? 'color-mix(in srgb, var(--accent) 45%, var(--border))' : 'var(--border)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--radius)',
        padding: mono ? '0.7rem 0.9rem' : '0.9rem 1rem',
        boxShadow: pending ? 'var(--shadow-glow)' : mono ? 'none' : 'var(--shadow)',
        opacity: mono ? 0.72 : 1,
        filter: mono ? 'saturate(0.15)' : 'none',
      }}
    >
      {/* Row 1: project · model · kind · time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        {e.project ? (
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 650,
              color: mono ? 'var(--muted)' : pColor,
              background: mono ? 'var(--bg-elev2)' : `color-mix(in srgb, ${pColor} 16%, transparent)`,
              padding: '0.15rem 0.55rem',
              borderRadius: '999px',
            }}
          >
            {e.project}
          </span>
        ) : null}
        {e.model ? (
          <span style={{ fontSize: '0.71rem', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.1rem 0.45rem', borderRadius: '999px' }}>
            {e.model}
          </span>
        ) : null}
        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 650,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: mono ? 'var(--faint)' : KIND_COLOR[e.kind],
            background: mono ? 'transparent' : `color-mix(in srgb, ${KIND_COLOR[e.kind]} 15%, transparent)`,
            padding: '0.13rem 0.5rem',
            borderRadius: '999px',
          }}
        >
          {KIND_LABEL[e.kind] ?? 'Event'}
        </span>
        <span style={{ fontSize: '0.77rem', color: 'var(--faint)', marginLeft: 'auto' }}>{timeAgo(e.created_at)}</span>
        {unread && !mono ? <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: 'var(--accent)' }} /> : null}
      </div>

      {e.task ? (
        <div style={{ fontSize: '0.77rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>
          <span style={{ opacity: 0.65 }}>Task:</span> {e.task}
        </div>
      ) : null}

      <div style={{ fontWeight: 600, lineHeight: 1.4, fontSize: mono ? '0.92rem' : '1rem' }}>{e.title}</div>

      {(e.tags.length > 0 || e.agent) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {e.tags.map((t) => (
            <span key={t} style={{ fontSize: '0.67rem', color: 'var(--muted)', background: 'var(--bg-elev2)', padding: '0.1rem 0.45rem', borderRadius: '0.3rem' }}>
              #{t}
            </span>
          ))}
          <span style={{ fontSize: '0.71rem', color: 'var(--faint)', marginLeft: e.tags.length ? 'auto' : 0 }}>{e.agent}</span>
        </div>
      )}

      {pending ? <div style={{ marginTop: '0.55rem', fontSize: '0.85rem', color: 'var(--accent-2)', fontWeight: 650 }}>Tap to answer →</div> : null}
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
            Point an agent at this hub and it'll show up here. See <Link to="/settings">Settings</Link> for the connection snippet.
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
