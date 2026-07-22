import { useEffect, useState } from 'react'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { api, AuthError, timeAgo, type TaskSummary } from '../lib/api'
import { Header, Container, LockedScreen, Spinner } from '../lib/shell'
import { projectColor, projectLabel, fromParam, KIND_LABEL, KIND_COLOR } from '../lib/project'

export const Route = createFileRoute('/project/$name')({
  component: ProjectView,
  ssr: false,
})

function ProjectView() {
  const { name } = useParams({ from: '/project/$name' })
  const project = fromParam(name)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')
  const [clearOpen, setClearOpen] = useState(false)

  async function load() {
    try {
      const res = await api.tasks(project)
      setTasks(res.tasks)
      setState('ok')
    } catch (e) {
      if (e instanceof AuthError) setState('locked')
    }
  }

  useEffect(() => {
    load()
    const tick = () => {
      if (document.visibilityState === 'visible') load()
    }
    const iv = setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  async function doClear(scope: 'read' | 'all') {
    setClearOpen(false)
    await api.clear(scope, project).catch(() => {})
    await load()
  }

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />

  const color = projectColor(project)
  const waiting = tasks.filter((t) => t.pending)
  const others = tasks.filter((t) => !t.pending)
  const active = others.filter((t) => t.unread > 0)
  const done = others.filter((t) => t.unread === 0)

  return (
    <>
      <Header
        right={
          <>
            <button onClick={() => setClearOpen((v) => !v)} title="Clear project" style={{ ...iconBtn, color: clearOpen ? 'var(--error)' : 'var(--text)' }}>
              <Trash2 size={18} />
            </button>
            <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
              <ArrowLeft size={16} /> Projects
            </Link>
          </>
        }
      />
      <Container>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.2rem' }}>
          <span style={{ width: '0.7rem', height: '0.7rem', borderRadius: '999px', background: color }} />
          <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{projectLabel(project)}</h1>
        </div>

        {clearOpen && (
          <ClearPanel onClear={doClear} onCancel={() => setClearOpen(false)} label={projectLabel(project)} />
        )}

        {tasks.length === 0 ? (
          <p style={{ color: 'var(--muted)', padding: '2rem 0', textAlign: 'center' }}>No tasks in this project.</p>
        ) : (
          <>
            {waiting.length > 0 && (
              <Section title={`Waiting on you · ${waiting.length}`} accent>
                {waiting.map((t) => (
                  <TaskCard key={t.key} t={t} project={project} variant="pending" />
                ))}
              </Section>
            )}
            {active.length > 0 && (
              <Section title="Active">
                {active.map((t) => (
                  <TaskCard key={t.key} t={t} project={project} variant="active" />
                ))}
              </Section>
            )}
            {done.length > 0 && (
              <Section title={`Done · ${done.length}`} muted>
                {done.map((t) => (
                  <TaskCard key={t.key} t={t} project={project} variant="mono" />
                ))}
              </Section>
            )}
          </>
        )}
      </Container>
    </>
  )
}

type Variant = 'pending' | 'active' | 'mono'

function TaskCard({ t, project, variant }: { t: TaskSummary; project: string; variant: Variant }) {
  const mono = variant === 'mono'
  const pending = variant === 'pending'
  const color = mono ? 'var(--border)' : projectColor(project)
  return (
    <Link
      to="/project/$name/task/$key"
      params={{ name: t.project === '' ? '__none__' : t.project, key: t.key }}
      className="animate-in"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--text)',
        background: pending
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--bg-elev)), var(--bg-elev))'
          : 'var(--bg-elev)',
        border: `1px solid ${pending ? 'color-mix(in srgb, var(--accent) 45%, var(--border))' : 'var(--border)'}`,
        borderLeft: `3px solid ${pending ? 'var(--accent)' : color}`,
        borderRadius: 'var(--radius)',
        padding: mono ? '0.7rem 0.9rem' : '0.9rem 1rem',
        boxShadow: pending ? 'var(--shadow-glow)' : mono ? 'none' : 'var(--shadow)',
        opacity: mono ? 0.72 : 1,
        filter: mono ? 'saturate(0.15)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
        {t.model ? (
          <span style={{ fontSize: '0.71rem', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.1rem 0.45rem', borderRadius: '999px' }}>
            {t.model}
          </span>
        ) : null}
        {!pending ? (
          <span style={{ fontSize: '0.68rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: mono ? 'var(--faint)' : KIND_COLOR[t.latest_kind], background: mono ? 'transparent' : `color-mix(in srgb, ${KIND_COLOR[t.latest_kind]} 15%, transparent)`, padding: '0.12rem 0.5rem', borderRadius: '999px' }}>
            {KIND_LABEL[t.latest_kind] ?? 'Event'}
          </span>
        ) : null}
        {t.count > 1 ? <span style={{ fontSize: '0.7rem', color: 'var(--faint)' }}>{t.count} messages</span> : null}
        <span style={{ fontSize: '0.76rem', color: 'var(--faint)', marginLeft: 'auto' }}>{timeAgo(t.last_activity)}</span>
      </div>

      <div style={{ fontWeight: 650, fontSize: mono ? '0.95rem' : '1.05rem', lineHeight: 1.35 }}>
        {t.task || t.latest_title}
      </div>

      {/* The actual thing being asked / the latest message */}
      <div style={{ fontSize: '0.88rem', color: pending ? 'var(--text)' : 'var(--muted)', marginTop: '0.3rem', lineHeight: 1.5 }}>
        {pending ? t.pending_question : t.task ? t.latest_title : null}
      </div>

      {pending ? <div style={{ marginTop: '0.55rem', fontSize: '0.85rem', color: 'var(--accent-2)', fontWeight: 650 }}>Tap to answer →</div> : null}
    </Link>
  )
}

function Section({ title, accent, muted, children }: { title: string; accent?: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '1.6rem' }}>
      <h2 style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: accent ? 'var(--accent-2)' : muted ? 'var(--faint)' : 'var(--muted)', margin: '0 0 0.7rem' }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>{children}</div>
    </section>
  )
}

function ClearPanel({ onClear, onCancel, label }: { onClear: (s: 'read' | 'all') => void; onCancel: () => void; label: string }) {
  return (
    <div className="animate-in" style={{ marginBottom: '1.2rem', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elev)', boxShadow: 'var(--shadow)' }}>
      <div style={{ fontWeight: 650, marginBottom: '0.25rem' }}>Clear “{label}”</div>
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 0.9rem' }}>Only affects this project. Can’t be undone.</p>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => onClear('read')} style={pBtn()}>Read &amp; answered</button>
        <button onClick={() => onClear('all')} style={{ ...pBtn(), color: 'var(--error)', borderColor: 'var(--error)' }}>Everything</button>
        <button onClick={onCancel} style={{ ...pBtn(), marginLeft: 'auto', color: 'var(--muted)' }}>Cancel</button>
      </div>
    </div>
  )
}

function pBtn(): React.CSSProperties {
  return { padding: '0.55rem 0.95rem', borderRadius: '0.55rem', border: '1px solid var(--border)', background: 'var(--bg-elev2)', color: 'var(--text)', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer' }
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
