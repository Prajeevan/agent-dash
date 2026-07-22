import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { api } from './api'

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.7rem 0.85rem',
  fontSize: '1rem',
  borderRadius: '0.6rem',
  border: '1px solid var(--border)',
  background: 'var(--bg-elev2)',
  color: 'var(--text)',
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.85rem',
  fontSize: '1rem',
  fontWeight: 700,
  borderRadius: '0.6rem',
  border: 'none',
  cursor: 'pointer',
  color: '#fff',
  background: 'linear-gradient(135deg, var(--accent), #c78bff)',
}

const codeBox: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-elev2)',
  border: '1px solid var(--border)',
  padding: '0.6rem 0.7rem',
  borderRadius: '0.5rem',
  color: '#c9b6ff',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.82rem',
  wordBreak: 'break-all',
}

// The login screen shown whenever the app gets a 401. Email → one-time code →
// (for a brand-new account) the agent key shown once, with connect steps.
export function LockedScreen() {
  const [stage, setStage] = useState<'email' | 'code' | 'key'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.requestCode(email.trim())
      if (!res.ok) setError(res.error ?? 'Something went wrong.')
      else setStage('code')
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.verifyCode(email.trim(), code.trim())
      if (!res.ok) {
        setError(res.error ?? 'Incorrect code.')
      } else if (res.new && res.agent_key) {
        setAgentKey(res.agent_key)
        setStage('key')
      } else {
        window.location.reload() // returning user — session set, load the app
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '25rem', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <Logo />
        </div>

        {stage === 'email' && (
          <form onSubmit={sendCode} style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem' }}>Sign in to Agent Dash</h1>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
              Enter your email and we'll send a one-time code.
            </p>
            <input
              type="email"
              autoFocus
              required
              placeholder="you@example.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              style={{ ...inputStyle, marginBottom: '0.75rem' }}
            />
            <button type="submit" disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {stage === 'code' && (
          <form onSubmit={verify} style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem' }}>Enter your code</h1>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
              We sent a 6-digit code to <strong style={{ color: 'var(--text)' }}>{email}</strong>.
            </p>
            <input
              inputMode="numeric"
              autoFocus
              required
              placeholder="123456"
              value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ ...inputStyle, marginBottom: '0.75rem', textAlign: 'center', letterSpacing: '0.3rem', fontSize: '1.3rem' }}
            />
            <button type="submit" disabled={busy || code.length !== 6} style={{ ...btnStyle, opacity: busy || code.length !== 6 ? 0.6 : 1 }}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setStage('email'); setCode(''); setError(null) }}
              style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              ← Use a different email
            </button>
          </form>
        )}

        {stage === 'key' && agentKey && (
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 0.5rem', textAlign: 'center' }}>You're in 🎉</h1>
            <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 1rem', textAlign: 'center' }}>
              Here's your agent key. <strong style={{ color: 'var(--text)' }}>Copy it now — it won't be shown again.</strong>
            </p>
            <code style={codeBox}>{agentKey}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(agentKey)}
              style={{ ...btnStyle, marginTop: '0.75rem' }}
            >
              Copy key
            </button>
            <div style={{ marginTop: '1.5rem' }}>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0 0 0.4rem' }}>Connect your agent:</p>
              <code style={{ ...codeBox, fontSize: '0.78rem' }}>
                npx agentdash login --url {origin} --key {agentKey.slice(0, 12)}…
              </code>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ marginTop: '1.25rem', width: '100%', padding: '0.6rem', background: 'none', border: '1px solid var(--border)', borderRadius: '0.6rem', color: 'var(--text)', cursor: 'pointer', fontSize: '0.95rem' }}
            >
              Continue to dashboard →
            </button>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--danger, #ff6b6b)', textAlign: 'center', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</p>
        )}
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
