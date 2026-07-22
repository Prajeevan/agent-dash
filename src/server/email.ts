import type { Env } from './env'

// ── Transactional email via Resend ───────────────────────────────────────────
// One job for now: deliver a login one-time code. In dev (no RESEND_API_KEY) we
// log the code to the console instead of sending, so the whole OTP flow works
// locally without a Resend account or a verified sending domain.

const DEFAULT_FROM = 'Agent Dash <onboarding@resend.dev>'

export async function sendOtpEmail(env: Env, to: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Dev bypass — no external send. The verify endpoint still checks this code.
    console.log(`\n[agent-dash] login code for ${to}: ${code}\n`)
    return
  }

  const from = env.EMAIL_FROM || DEFAULT_FROM
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Agent Dash code: ${code}`,
      text: `Your Agent Dash login code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      html: otpHtml(code),
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Surface enough to debug (bad key, unverified domain) without leaking the code.
    throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 300)}`)
  }
}

function otpHtml(code: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0a0a0f;color:#e8e8f0;font-family:system-ui,sans-serif;padding:2rem">
  <div style="max-width:28rem;margin:0 auto;text-align:center">
    <h1 style="font-size:1.3rem;margin:0 0 1rem">Your login code</h1>
    <div style="font-size:2.2rem;letter-spacing:.4rem;font-weight:700;background:#1a1a24;border-radius:.6rem;padding:1rem;color:#c9b6ff">${code}</div>
    <p style="color:#9aa;line-height:1.6;margin-top:1rem">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
  </div></body></html>`
}
