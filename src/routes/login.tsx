import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../lib/api'
import { Logo } from '../lib/shell'

export const Route = createFileRoute('/login')({
  component: LoginPage,
  ssr: false,
})

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

// Email → one-time code → (for a brand-new account) the agent key shown once,
// with connect steps. On success we hard-navigate to '/' so the freshly-set
// session cookie is picked up.
function LoginPage() {
  const [stage, setStage] = useState<'email' | 'code' | 'key'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'' | 'key' | 'cmd'>('')

  function copy(what: 'key' | 'cmd', text: string) {
    navigator.clipboard?.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(''), 1500)
  }

  // Already signed in? Skip straight to the dashboard.
  useEffect(() => {
    api.account().then(() => { window.location.href = '/' }).catch(() => {})
  }, [])

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
        window.location.href = '/' // returning user — session set, load the app
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '25rem', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <a href="/" aria-label="Home"><Logo /></a>
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
              onClick={() => copy('key', agentKey)}
              style={{ ...btnStyle, marginTop: '0.75rem' }}
            >
              {copied === 'key' ? 'Copied ✓' : 'Copy key'}
            </button>
            <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0 0 0.4rem' }}>
                <strong style={{ color: 'var(--text)' }}>Step 1.</strong> Add Agent Dash to your agent:
              </p>
              <div style={{ position: 'relative' }}>
                <code style={{ ...codeBox, fontSize: '0.78rem', paddingRight: '4.5rem' }}>
                  npx skills add Prajeevan/agent-dash
                </code>
                <button
                  type="button"
                  onClick={() => copy('cmd', 'npx skills add Prajeevan/agent-dash')}
                  style={{
                    position: 'absolute', top: '0.4rem', right: '0.4rem',
                    background: 'var(--bg-elev)', border: '1px solid var(--border)',
                    borderRadius: '0.4rem', padding: '0.25rem 0.55rem', fontSize: '0.72rem',
                    color: 'var(--text)', cursor: 'pointer',
                  }}
                >
                  {copied === 'cmd' ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0.8rem 0 0' }}>
                <strong style={{ color: 'var(--text)' }}>Step 2.</strong> When your agent asks, paste the
                key above. That's it — it'll start reporting here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { window.location.href = '/' }}
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
