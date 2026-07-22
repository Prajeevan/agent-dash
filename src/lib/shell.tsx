import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'

export function Header({
  live,
  right,
}: {
  live?: boolean
  right?: React.ReactNode
}) {
  return (
    <header
      className="safe-top"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0.75rem 1rem',
      }}
    >
      <div style={{ maxWidth: '46rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', textDecoration: 'none', color: 'var(--text)' }}>
            <Logo />
            <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>Agent Dash</span>
            {live ? (
              <span className="live-dot" title="Live" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: 'var(--success)', marginLeft: '0.1rem' }} />
            ) : null}
          </Link>
          <ProButton />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{right}</div>
      </div>
    </header>
  )
}

function ProButton() {
  return (
    <Link
      to="/pro"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        textDecoration: 'none',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: '#fff',
        background: 'linear-gradient(135deg, var(--accent), #c78bff)',
        padding: '0.22rem 0.6rem',
        borderRadius: '999px',
        boxShadow: '0 2px 10px -2px color-mix(in srgb, var(--accent) 60%, transparent)',
        whiteSpace: 'nowrap',
      }}
    >
      ✦ Pro
    </Link>
  )
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#7c5cff" />
      <path d="M16 7a6 6 0 0 0-6 6v3.6l-1.4 2.2a1 1 0 0 0 .85 1.53h13.1a1 1 0 0 0 .85-1.53L22 16.6V13a6 6 0 0 0-6-6Z" fill="#fff" />
      <path d="M13.6 22.5a2.5 2.5 0 0 0 4.8 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Container({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-bottom" style={{ maxWidth: '46rem', margin: '0 auto', padding: '1rem' }}>
      {children}
    </main>
  )
}

// App pages (settings, project, thread…) render this when they hit a 401 — it
// bounces to the dedicated /login route. The public landing lives at '/'.
export function LockedScreen() {
  useEffect(() => {
    window.location.href = '/login'
  }, [])
  return <Spinner />
}

// The public marketing page shown at '/' to logged-out visitors. A signed-in
// visitor never sees this — index.tsx renders the dashboard instead.
export function Landing() {
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: '0.8rem',
    padding: '1rem 1.1rem',
    textAlign: 'left',
  }
  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '34rem', width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem' }}>
          <Logo />
          <span style={{ fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-0.01em' }}>Agent Dash</span>
        </div>

        <h1 style={{ fontSize: '2rem', lineHeight: 1.15, margin: '0 0 0.75rem', letterSpacing: '-0.02em' }}>
          Your agents report here.
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1.05rem', lineHeight: 1.6, margin: '0 auto 1.75rem', maxWidth: '28rem' }}>
          A push inbox for AI agents. They send you progress updates as phone
          notifications — and can ask a question and wait for your answer before
          continuing.
        </p>

        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <a
            href="/login"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              textDecoration: 'none', fontWeight: 700, fontSize: '1rem',
              color: '#fff', background: 'linear-gradient(135deg, var(--accent), #c78bff)',
              padding: '0.7rem 1.4rem', borderRadius: '0.6rem',
            }}
          >
            Get started — it's free →
          </a>
          <a
            href="https://github.com/Prajeevan/agent-dash"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center',
              textDecoration: 'none', fontWeight: 600, fontSize: '1rem',
              color: 'var(--text)', background: 'var(--bg-elev2)',
              border: '1px solid var(--border)', padding: '0.7rem 1.2rem', borderRadius: '0.6rem',
            }}
          >
            Learn more
          </a>
        </div>

        <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: '1fr', textAlign: 'left' }}>
          <div style={cardStyle}>
            <strong style={{ fontSize: '0.95rem' }}>🔔 Push, not polling</strong>
            <p style={{ color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.55, margin: '0.3rem 0 0' }}>
              Milestones, errors, and “done” land as real notifications on your phone.
            </p>
          </div>
          <div style={cardStyle}>
            <strong style={{ fontSize: '0.95rem' }}>💬 Ask &amp; wait</strong>
            <p style={{ color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.55, margin: '0.3rem 0 0' }}>
              Agents pose a question with buttons or a form and pause until you answer.
            </p>
          </div>
          <div style={cardStyle}>
            <strong style={{ fontSize: '0.95rem' }}>🔌 Connect anything</strong>
            <p style={{ color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.55, margin: '0.3rem 0 0' }}>
              One-line MCP server, a portable skill, or a single curl. Sign in to get your key.
            </p>
          </div>
        </div>

        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '2rem' }}>
          Sign in with just your email — no password.
        </p>
      </div>
    </div>
  )
}

export function Spinner() {
  return (
    <div style={{ minHeight: '60svh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
      Loading…
    </div>
  )
}

export function Badge({ kind }: { kind: string }) {
  const map: Record<string, [string, string]> = {
    update: ['Update', 'var(--info)'],
    question: ['Question', 'var(--accent)'],
    done: ['Done', 'var(--success)'],
    error: ['Error', 'var(--error)'],
  }
  const [label, color] = map[kind] ?? ['Event', 'var(--muted)']
  return (
    <span style={{ fontSize: '0.7rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color, background: `color-mix(in srgb, ${color} 15%, transparent)`, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
      {label}
    </span>
  )
}
