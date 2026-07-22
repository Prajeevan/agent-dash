import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Bell, BellOff } from 'lucide-react'
import { api, AuthError } from '../lib/api'
import { Header, Container, LockedScreen, Spinner } from '../lib/shell'
import { getEncKey, setEncKey, clearEncKey, generateEncKey } from '../lib/e2e'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  ssr: false,
})

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function SettingsPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'ok' | 'locked'>('loading')
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [quiet, setQuiet] = useState<{ start: number; end: number } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const s = await api.settings()
        const q = s.quiet_hours as { start: number; end: number } | null
        setQuiet(q)
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready.catch(() => null)
          const sub = await reg?.pushManager.getSubscription()
          setPushOn(!!sub)
        }
        setState('ok')
      } catch (e) {
        if (e instanceof AuthError) setState('locked')
      }
    })()
  }, [])

  async function enablePush() {
    setPushBusy(true)
    setPushMsg(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushMsg('This browser does not support push. On iOS, add this app to your Home Screen first.')
        setPushBusy(false)
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPushMsg('Notification permission was denied.')
        setPushBusy(false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const { key } = await api.vapid()
      if (!key) {
        setPushMsg('Server is missing VAPID keys. Re-run setup.')
        setPushBusy(false)
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
      await api.subscribePush(sub.toJSON())
      setPushOn(true)
      setPushMsg('Notifications enabled on this device.')
    } catch (e) {
      setPushMsg('Could not enable push: ' + (e as Error).message)
    }
    setPushBusy(false)
  }

  async function disablePush() {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.unsubscribePush(sub.endpoint)
        await sub.unsubscribe()
      }
      setPushOn(false)
      setPushMsg('Notifications disabled on this device.')
    } catch {
      /* ignore */
    }
    setPushBusy(false)
  }

  async function saveQuiet(next: { start: number; end: number } | null) {
    setQuiet(next)
    const offsetMin = -new Date().getTimezoneOffset()
    await api.putSettings({ quiet_hours: next ? { ...next, offsetMin } : null }).catch(() => {})
  }

  if (state === 'loading') return <Spinner />
  if (state === 'locked') return <LockedScreen />

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

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
        <h1 style={{ fontSize: '1.4rem', margin: '0 0 1.5rem' }}>Settings</h1>

        <Card title="Notifications">
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            Get a push on this device when an agent needs you or flags something important.
          </p>
          {pushOn ? (
            <button onClick={disablePush} disabled={pushBusy} style={btn(false)}>
              <BellOff size={16} /> Disable on this device
            </button>
          ) : (
            <button onClick={enablePush} disabled={pushBusy} style={btn(true)}>
              <Bell size={16} /> Enable notifications
            </button>
          )}
          {pushMsg ? <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.8rem' }}>{pushMsg}</p> : null}
        </Card>

        <Card title="Quiet hours">
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            Silence non-urgent pings during these hours. Urgent (priority 2) always rings through.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem' }}>
            <input
              type="checkbox"
              checked={!!quiet}
              onChange={(e) => saveQuiet(e.target.checked ? { start: 22 * 60, end: 7 * 60 } : null)}
            />
            <span style={{ fontSize: '0.9rem' }}>Enable quiet hours</span>
          </label>
          {quiet && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <TimeField label="From" minutes={quiet.start} onChange={(m) => saveQuiet({ ...quiet, start: m })} />
              <TimeField label="To" minutes={quiet.end} onChange={(m) => saveQuiet({ ...quiet, end: m })} />
            </div>
          )}
        </Card>

        <Card title="Your agent key">
          <AgentKeyCard />
        </Card>

        <Card title="Connect an agent">
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 0.8rem' }}>
            MCP clients (Claude Code, Cursor, Codex) — add this server. Use your <code>AGENT_KEY</code>.
          </p>
          <Snippet
            text={`{
  "mcpServers": {
    "agent-dash": {
      "url": "${origin}/mcp",
      "headers": { "Authorization": "Bearer YOUR_AGENT_KEY" }
    }
  }
}`}
          />
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '1rem 0 0.5rem' }}>
            Any agent (or a raw chat) — one curl to push an update:
          </p>
          <Snippet
            text={`curl -X POST ${origin}/api/v1/events \\
  -H "Authorization: Bearer YOUR_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent":"claude","title":"Build finished","priority":1}'`}
          />
          <p style={{ fontSize: '0.85rem', marginTop: '0.8rem' }}>
            Full contract: <a href="/api/v1/schema.json" target="_blank" rel="noreferrer">block schema</a> ·{' '}
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI</a>
          </p>
        </Card>

        <Card title="Encryption (E2E)">
          <EncryptionCard />
        </Card>

        <Card title="Clear inbox">
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            Tidy up or start fresh. Agents can also clear things themselves when it gets cluttered.
          </p>
          <ClearButtons />
        </Card>

        <Card title="Session">
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={() => api.logout().then(() => navigate({ to: '/' }))} style={btn(false)}>
              Log out (this device)
            </button>
            <button onClick={() => api.logoutAll().then(() => navigate({ to: '/' }))} style={{ ...btn(false), color: 'var(--error)', borderColor: 'var(--error)' }}>
              Log out everywhere
            </button>
          </div>
        </Card>
      </Container>
    </>
  )
}

function TimeField({ label, minutes, onChange }: { label: string; minutes: number; onChange: (m: number) => void }) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
      {label}
      <input
        type="time"
        value={`${hh}:${mm}`}
        onChange={(e) => {
          const [h, m] = e.target.value.split(':').map(Number)
          onChange(h * 60 + m)
        }}
        style={{ background: 'var(--bg-elev2)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.5rem', color: 'var(--text)' }}
      />
    </label>
  )
}

function EncryptionCard() {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setSaved(getEncKey())
  }, [])

  function save(k: string) {
    const v = k.trim()
    if (!v) return
    setEncKey(v)
    setSaved(v)
    setKey('')
    setMsg('Key saved on this device. Give the SAME key to your agent (CLI: --enc-key).')
  }

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
        With a key set, message content is decrypted here on your device — the server only ever
        stores ciphertext it can’t read. The key never leaves this device. Give the same key to
        your agent so it can encrypt.
      </p>
      {saved ? (
        <div style={{ marginBottom: '0.9rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontWeight: 600, fontSize: '0.9rem' }}>
            🔒 Encryption on
          </div>
          <pre style={{ margin: '0.5rem 0 0', background: 'var(--bg-elev2)', padding: '0.6rem', borderRadius: '0.5rem', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--muted)' }}>
            <code>{saved}</code>
          </pre>
          <button onClick={() => { clearEncKey(); setSaved(null); setMsg('Encryption turned off on this device.') }} style={{ ...btn(false), marginTop: '0.7rem', color: 'var(--error)', borderColor: 'var(--error)' }}>
            Turn off
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your encryption key"
            style={{ background: 'var(--bg-elev2)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.6rem 0.7rem', color: 'var(--text)', fontSize: '0.85rem', fontFamily: 'monospace' }}
          />
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button onClick={() => save(key)} style={btn(true)}>Save key</button>
            <button onClick={() => save(generateEncKey())} style={btn(false)}>Generate a new key</button>
          </div>
        </div>
      )}
      {msg ? <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.8rem' }}>{msg}</p> : null}
    </div>
  )
}

function ClearButtons() {
  const [confirming, setConfirming] = useState<null | 'read' | 'all'>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(scope: 'read' | 'all') {
    setConfirming(null)
    const res = await api.clear(scope).catch(() => null)
    setMsg(res ? `Cleared ${res.cleared} item${res.cleared === 1 ? '' : 's'}.` : 'Could not clear.')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => setConfirming('read')} style={btn(false)}>
          Clear read &amp; answered
        </button>
        <button onClick={() => setConfirming('all')} style={{ ...btn(false), color: 'var(--error)', borderColor: 'var(--error)' }}>
          Restart — clear everything
        </button>
      </div>
      {confirming ? (
        <div style={{ marginTop: '0.9rem', padding: '0.8rem', border: '1px solid var(--error)', borderRadius: '0.6rem', background: 'color-mix(in srgb, var(--error) 8%, transparent)' }}>
          <p style={{ margin: '0 0 0.7rem', fontSize: '0.9rem' }}>
            {confirming === 'all'
              ? 'Delete ALL messages, including unanswered questions? This cannot be undone.'
              : 'Delete everything you have already read or answered?'}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button onClick={() => run(confirming)} style={{ ...btn(true), background: 'var(--error)' }}>
              Yes, clear
            </button>
            <button onClick={() => setConfirming(null)} style={btn(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {msg ? <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.8rem' }}>{msg}</p> : null}
    </div>
  )
}

// Shows the account's key prefix (the raw key is never stored, so it can't be
// re-shown) and lets the user rotate to a fresh key — revealed once.
function AgentKeyCard() {
  const [email, setEmail] = useState<string | null>(null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const [rotated, setRotated] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.account().then((a) => { setEmail(a.email); setPrefix(a.key_prefix) }).catch(() => {})
  }, [])

  async function rotate() {
    setConfirming(false)
    setBusy(true)
    try {
      const res = await api.rotateKey()
      setRotated(res.agent_key)
      setPrefix(res.agent_key.slice(0, 16))
    } catch {
      /* ignore */
    }
    setBusy(false)
  }

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 0.8rem' }}>
        {email ? <>Signed in as <strong style={{ color: 'var(--text)' }}>{email}</strong>. </> : null}
        Agents authenticate with this key. It's stored only as a hash — we can't show it again, so
        rotate if you lose it.
      </p>

      {rotated ? (
        <div style={{ marginBottom: '0.9rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--success)', margin: '0 0 0.4rem', fontWeight: 600 }}>
            New key — copy it now, it won't be shown again:
          </p>
          <Snippet text={rotated} />
        </div>
      ) : (
        <p style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 0.9rem' }}>
          {prefix ? `${prefix}…` : 'Loading…'}
        </p>
      )}

      {confirming ? (
        <div style={{ padding: '0.8rem', border: '1px solid var(--error)', borderRadius: '0.6rem', background: 'color-mix(in srgb, var(--error) 8%, transparent)' }}>
          <p style={{ margin: '0 0 0.7rem', fontSize: '0.9rem' }}>
            Rotate the key? The current key stops working immediately — every connected agent must be
            updated with the new one.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button onClick={rotate} disabled={busy} style={{ ...btn(true), background: 'var(--error)' }}>
              Yes, rotate
            </button>
            <button onClick={() => setConfirming(false)} style={btn(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} style={btn(false)}>Rotate key</button>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '0.9rem', padding: '1.1rem', marginBottom: '1rem' }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.8rem' }}>{title}</h2>
      {children}
    </section>
  )
}

function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{ margin: 0, background: 'var(--bg-elev2)', padding: '0.8rem', borderRadius: '0.5rem', fontSize: '0.78rem', overflowX: 'auto' }}>
        <code>{text}</code>
      </pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: 'var(--text)', cursor: 'pointer' }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.6rem 1rem',
    borderRadius: '0.6rem',
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg-elev2)',
    color: primary ? '#fff' : 'var(--text)',
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer',
  }
}
