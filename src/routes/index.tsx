import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings2, ChevronRight, Inbox as InboxIcon } from 'lucide-react'
import { api, AuthError, timeAgo, type ProjectRow } from '../lib/api'
import { Header, Container, LockedScreen, Spinner } from '../lib/shell'
import { projectColor, projectLabel, toParam } from '../lib/project'

export const Route = createFileRoute('/')({
  component: Projects,
  ssr: false,
})

function Projects() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')

  async function load() {
    try {
      const res = await api.projects()
      setProjects(res.projects)
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
  }, [])

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />

  const waiting = projects.filter((p) => p.pending > 0)
  const rest = projects.filter((p) => p.pending === 0)

  return (
    <>
      <Header
        live
        right={
          <Link to="/settings" title="Settings" style={{ ...iconBtn, display: 'inline-flex' }}>
            <Settings2 size={18} />
          </Link>
        }
      />
      <Container>
        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {waiting.length > 0 && (
              <Section title={`Needs you · ${waiting.reduce((n, p) => n + p.pending, 0)}`} accent>
                {waiting.map((p) => (
                  <ProjectCard key={p.project || '__none__'} p={p} highlight />
                ))}
              </Section>
            )}
            <Section title="Projects">
              {rest.map((p) => (
                <ProjectCard key={p.project || '__none__'} p={p} />
              ))}
              {rest.length === 0 && waiting.length > 0 ? (
                <p style={{ color: 'var(--faint)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                  Everything else is up to date.
                </p>
              ) : null}
            </Section>
          </>
        )}
      </Container>
    </>
  )
}

function ProjectCard({ p, highlight }: { p: ProjectRow; highlight?: boolean }) {
  const color = projectColor(p.project)
  return (
    <Link
      to="/project/$name"
      params={{ name: toParam(p.project) }}
      className="animate-in"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.9rem',
        textDecoration: 'none',
        color: 'var(--text)',
        background: highlight
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--bg-elev)), var(--bg-elev))'
          : 'var(--bg-elev)',
        border: `1px solid ${highlight ? 'color-mix(in srgb, var(--accent) 45%, var(--border))' : 'var(--border)'}`,
        borderLeft: `3px solid ${highlight ? 'var(--accent)' : color}`,
        borderRadius: 'var(--radius)',
        padding: '1rem',
        boxShadow: highlight ? 'var(--shadow-glow)' : 'var(--shadow)',
      }}
    >
      <div style={{ width: '2.4rem', height: '2.4rem', borderRadius: '0.7rem', background: `color-mix(in srgb, ${color} 22%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {p.project === '' ? <InboxIcon size={18} color={color} /> : <span style={{ fontWeight: 700, color, fontSize: '1.05rem' }}>{p.project[0]?.toUpperCase()}</span>}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 650, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectLabel(p.project)}
          </span>
          {p.pending > 0 ? (
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '0.1rem 0.45rem', borderRadius: '999px' }}>
              {p.pending} waiting
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
          {p.models.slice(0, 3).map((m) => (
            <span key={m} style={{ fontSize: '0.7rem', color: 'var(--muted)', border: '1px solid var(--border)', padding: '0.08rem 0.4rem', borderRadius: '999px' }}>
              {m}
            </span>
          ))}
          <span style={{ fontSize: '0.74rem', color: 'var(--faint)' }}>
            {p.total} item{p.total === 1 ? '' : 's'} · {timeAgo(p.last_activity)}
          </span>
        </div>
      </div>

      <ChevronRight size={18} color="var(--faint)" style={{ flexShrink: 0 }} />
    </Link>
  )
}

function Section({ title, accent, children }: { title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '1.6rem' }}>
      <h2 style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: accent ? 'var(--accent-2)' : 'var(--muted)', margin: '0 0 0.7rem' }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>{children}</div>
    </section>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)' }}>
      <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No projects yet.</p>
      <p style={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
        When an agent sends its first update with a <code>project</code>, it'll appear here. See{' '}
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
