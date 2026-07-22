import { useState } from 'react'

// ── Minimal, XSS-safe markdown → React ───────────────────────────────────────
// We never dangerouslySetInnerHTML agent content. Text is escaped by React by
// default; here we only turn a small, known set of markdown into real elements.
function inline(text: string, key: string): React.ReactNode[] {
  // Split on **bold**, `code`, and [label](url) — everything else is plain text.
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={`${key}-${i}`}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={`${key}-${i}`}>{tok.slice(1, -1)}</code>)
    else {
      const lm = tok.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/)
      if (lm)
        parts.push(
          <a key={`${key}-${i}`} href={lm[2]} target="_blank" rel="noopener noreferrer">
            {lm[1]}
          </a>,
        )
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flush = (k: string) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${k}`}>
          {list.map((li, i) => (
            <li key={i}>{inline(li, `${k}-${i}`)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }
  lines.forEach((line, idx) => {
    const k = String(idx)
    if (/^###\s+/.test(line)) {
      flush(k)
      out.push(<h3 key={k}>{inline(line.replace(/^###\s+/, ''), k)}</h3>)
    } else if (/^##\s+/.test(line)) {
      flush(k)
      out.push(<h2 key={k}>{inline(line.replace(/^##\s+/, ''), k)}</h2>)
    } else if (/^#\s+/.test(line)) {
      flush(k)
      out.push(<h1 key={k}>{inline(line.replace(/^#\s+/, ''), k)}</h1>)
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flush(k)
    } else {
      flush(k)
      out.push(<p key={k}>{inline(line, k)}</p>)
    }
  })
  flush('end')
  return <div className="md">{out}</div>
}

// ── Display blocks ───────────────────────────────────────────────────────────
type AnyBlock = Record<string, unknown> & { type: string }

const TONE: Record<string, string> = {
  info: 'var(--info)',
  success: 'var(--success)',
  warn: 'var(--warn)',
  error: 'var(--error)',
}

export function BlockRenderer({ blocks }: { blocks: unknown[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {(blocks as AnyBlock[]).map((b, i) => (
        <One key={i} b={b} />
      ))}
    </div>
  )
}

function One({ b }: { b: AnyBlock }) {
  switch (b.type) {
    case 'markdown':
      return <MiniMarkdown text={String(b.text ?? '')} />
    case 'callout': {
      const tone = String(b.tone ?? 'info')
      return (
        <div
          style={{
            borderLeft: `3px solid ${TONE[tone] ?? TONE.info}`,
            background: 'var(--bg-elev2)',
            padding: '0.7rem 0.9rem',
            borderRadius: '0.4rem',
            lineHeight: 1.5,
          }}
        >
          {String(b.text ?? '')}
        </div>
      )
    }
    case 'progress': {
      const value = Number(b.value ?? 0)
      const max = Number(b.max ?? 100) || 100
      const pct = Math.max(0, Math.min(100, (value / max) * 100))
      return (
        <div>
          {b.label ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: 'var(--muted)' }}>
              <span>{String(b.label)}</span>
              <span>{Math.round(pct)}%</span>
            </div>
          ) : null}
          <div style={{ height: '0.5rem', background: 'var(--bg-elev2)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: '999px', transition: 'width .3s' }} />
          </div>
        </div>
      )
    }
    case 'keyvalue': {
      const items = (b.items as { k: string; v: string }[]) ?? []
      return (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--muted)' }}>{it.k}</span>
              <span style={{ textAlign: 'right', fontWeight: 550 }}>{it.v}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'table': {
      const columns = (b.columns as string[]) ?? []
      const rows = (b.rows as string[][]) ?? []
      return (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.7rem', color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} style={{ padding: '0.5rem 0.7rem', borderBottom: ri === rows.length - 1 ? 'none' : '1px solid var(--border)' }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'link':
      return (
        <a href={String(b.url)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 550 }}>
          {String(b.label ?? b.url)} ↗
        </a>
      )
    case 'image':
      return (
        <img src={String(b.url)} alt={String(b.alt ?? '')} style={{ maxWidth: '100%', borderRadius: '0.5rem' }} loading="lazy" />
      )
    case 'code':
      return (
        <pre style={{ overflowX: 'auto', background: 'var(--bg-elev2)', padding: '0.8rem', borderRadius: '0.5rem', fontSize: '0.82rem', margin: 0 }}>
          <code>{String(b.text ?? '')}</code>
        </pre>
      )
    // Interactive blocks are rendered by AnswerForm, not here.
    case 'buttons':
    case 'form':
      return null
    default:
      return null
  }
}

// ── Interactive: collect the answer and submit ───────────────────────────────
export function AnswerForm({
  blocks,
  disabled,
  onSubmit,
}: {
  blocks: unknown[]
  disabled?: boolean
  onSubmit: (answer: Record<string, unknown>) => void
}) {
  const interactive = (blocks as AnyBlock[]).filter((b) => b.type === 'buttons' || b.type === 'form')
  const [form, setForm] = useState<Record<string, Record<string, unknown>>>({})

  const setField = (formId: string, fieldId: string, value: unknown) =>
    setForm((f) => ({ ...f, [formId]: { ...(f[formId] ?? {}), [fieldId]: value } }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {interactive.map((b, i) => {
        if (b.type === 'buttons') {
          const options = (b.options as string[]) ?? []
          const id = String(b.id)
          return (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {options.map((opt) => (
                <button
                  key={opt}
                  disabled={disabled}
                  onClick={() => onSubmit({ [id]: opt })}
                  style={btnStyle(false, disabled)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )
        }
        // form
        const id = String(b.id)
        const fields = (b.fields as AnyBlock[]) ?? []
        return (
          <form
            key={i}
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit({ [id]: form[id] ?? {} })
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
          >
            {fields.map((f, fi) => (
              <FieldInput key={fi} field={f} value={form[id]?.[String(f.id)]} onChange={(v) => setField(id, String(f.id), v)} />
            ))}
            <button type="submit" disabled={disabled} style={btnStyle(true, disabled)}>
              {String(b.submitLabel ?? 'Submit')}
            </button>
          </form>
        )
      })}
    </div>
  )
}

function FieldInput({ field, value, onChange }: { field: AnyBlock; value: unknown; onChange: (v: unknown) => void }) {
  const kind = String(field.kind)
  const label = String(field.label ?? '')
  const options = (field.options as string[]) ?? []
  const req = Boolean(field.required)

  const wrap = (child: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' }}>
      <span style={{ color: 'var(--muted)' }}>
        {label}
        {req ? <span style={{ color: 'var(--error)' }}> *</span> : null}
      </span>
      {child}
    </label>
  )

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-elev2)',
    border: '1px solid var(--border)',
    borderRadius: '0.5rem',
    padding: '0.6rem 0.7rem',
    color: 'var(--text)',
    fontSize: '0.95rem',
    width: '100%',
  }

  if (kind === 'textarea')
    return wrap(
      <textarea required={req} rows={3} placeholder={String(field.placeholder ?? '')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle} />,
    )
  if (kind === 'select')
    return wrap(
      <select required={req} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>,
    )
  if (kind === 'radio')
    return wrap(
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{ ...pillStyle, ...(value === o ? pillActive : {}) }}
          >
            {o}
          </button>
        ))}
      </div>,
    )
  if (kind === 'checkbox') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return wrap(
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {options.map((o) => {
          const on = arr.includes(o)
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
              style={{ ...pillStyle, ...(on ? pillActive : {}) }}
            >
              {on ? '✓ ' : ''}{o}
            </button>
          )
        })}
      </div>,
    )
  }
  return wrap(
    <input
      type={kind === 'number' ? 'number' : 'text'}
      required={req}
      placeholder={String(field.placeholder ?? '')}
      value={String(value ?? '')}
      onChange={(e) => onChange(kind === 'number' ? e.target.valueAsNumber : e.target.value)}
      style={inputStyle}
    />,
  )
}

function btnStyle(primary: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: '0.7rem 1.1rem',
    borderRadius: '0.6rem',
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg-elev2)',
    color: primary ? '#fff' : 'var(--text)',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

const pillStyle: React.CSSProperties = {
  padding: '0.5rem 0.85rem',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  background: 'var(--bg-elev2)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  cursor: 'pointer',
}
const pillActive: React.CSSProperties = {
  background: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: '#fff',
}
