import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Zap, Cloud, Users, Smartphone, Headphones, Lock } from 'lucide-react'
import { Header, Container } from '../lib/shell'

export const Route = createFileRoute('/pro')({
  component: Pro,
  ssr: false,
})

const FEATURES = [
  { icon: Zap, title: 'Instant delivery', body: 'Sub-second push and answers over a live connection — no 10-second polling. Your agent continues the moment you tap.' },
  { icon: Cloud, title: 'Fully hosted', body: 'No Cloudflare account, no setup. Run `npx agent-dash login`, scan the QR, and your hub is live in seconds.' },
  { icon: Users, title: 'Team inboxes', body: 'Share a hub with your team. Route an agent’s questions to whoever’s on call, with per-person notifications.' },
  { icon: Smartphone, title: 'Multiple devices + long history', body: 'Every phone and laptop stays in sync, and your inbox keeps months of history instead of days.' },
  { icon: Headphones, title: 'Priority support', body: 'Direct help wiring agents in, plus early access to new block types and integrations.' },
]

function Pro() {
  return (
    <>
      <Header
        right={
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
            <ArrowLeft size={16} /> Back
          </Link>
        }
      />
      <Container>
        <div style={{ textAlign: 'center', margin: '1rem 0 2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, var(--accent), #c78bff)', padding: '0.25rem 0.7rem', borderRadius: '999px', marginBottom: '1rem' }}>
            ✦ Agent Dash Pro
          </div>
          <h1 style={{ fontSize: '1.7rem', lineHeight: 1.2, margin: '0 0 0.6rem' }}>
            Everything in the free hub — instant, hosted, and shareable.
          </h1>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6, maxWidth: '34rem', margin: '0 auto' }}>
            The open-source hub you’re using stays free forever, self-hosted on your own Cloudflare.
            Pro adds the things that need always-on infrastructure.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginBottom: '2rem' }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ display: 'flex', gap: '0.9rem', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', boxShadow: 'var(--shadow)' }}>
              <div style={{ width: '2.4rem', height: '2.4rem', flexShrink: 0, borderRadius: '0.6rem', background: 'color-mix(in srgb, var(--accent) 18%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <f.icon size={18} color="var(--accent-2)" />
              </div>
              <div>
                <div style={{ fontWeight: 650, marginBottom: '0.2rem' }}>{f.title}</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--muted)', lineHeight: 1.55 }}>{f.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, var(--bg-elev)), var(--bg-elev))', border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))', borderRadius: 'var(--radius)', padding: '1.4rem', textAlign: 'center', boxShadow: 'var(--shadow-glow)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.6rem' }}>
            <Lock size={14} /> End-to-end encryption included on every tier
          </div>
          <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.4rem' }}>Pro is coming soon.</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1.1rem' }}>
            Want instant + hosted when it launches? Join the waitlist.
          </p>
          <a
            href="mailto:hello@agent-dash.dev?subject=Agent%20Dash%20Pro%20waitlist"
            style={{ display: 'inline-block', background: 'linear-gradient(135deg, var(--accent), #c78bff)', color: '#fff', fontWeight: 700, textDecoration: 'none', padding: '0.7rem 1.6rem', borderRadius: '0.7rem' }}
          >
            Join the waitlist
          </a>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '0.8rem', marginTop: '1.5rem' }}>
          The single-user core is MIT-licensed and free forever. Pro funds the hosted infrastructure.
        </p>
      </Container>
    </>
  )
}
