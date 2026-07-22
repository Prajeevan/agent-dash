import { z } from 'zod'

// ── The block system ───────────────────────────────────────────────────────
// Agents never send HTML. They send a JSON array of typed blocks, validated
// here, rendered by the dashboard. Slack Block Kit / Adaptive Cards pattern:
// LLMs emit schema-conformant JSON reliably, and we never render agent markup.
//
// Display blocks are valid in any event. Interactive blocks (buttons, form)
// are only meaningful inside a kind:"question" event — enforced in the API.

const Markdown = z.object({
  type: z.literal('markdown'),
  text: z.string().max(20_000),
})

const Progress = z.object({
  type: z.literal('progress'),
  label: z.string().max(200).optional(),
  value: z.number(),
  max: z.number().default(100),
})

const KeyValue = z.object({
  type: z.literal('keyvalue'),
  items: z
    .array(z.object({ k: z.string().max(200), v: z.string().max(2000) }))
    .max(50),
})

const Table = z.object({
  type: z.literal('table'),
  columns: z.array(z.string().max(120)).max(12),
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(200),
})

const Link = z.object({
  type: z.literal('link'),
  url: z.string().url().max(2000),
  label: z.string().max(200).optional(),
})

const Img = z.object({
  type: z.literal('image'),
  url: z.string().url().max(2000), // URL only in v1 — no data: URIs
  alt: z.string().max(400).optional(),
})

const Code = z.object({
  type: z.literal('code'),
  lang: z.string().max(40).optional(),
  text: z.string().max(20_000),
})

const Callout = z.object({
  type: z.literal('callout'),
  tone: z.enum(['info', 'success', 'warn', 'error']).default('info'),
  text: z.string().max(4000),
})

// ── Interactive blocks (questions only) ──────────────────────────────────────

const Buttons = z.object({
  type: z.literal('buttons'),
  id: z.string().max(80),
  options: z.array(z.string().max(200)).min(1).max(8),
})

const Field = z.object({
  id: z.string().max(80),
  kind: z.enum(['text', 'textarea', 'number', 'select', 'radio', 'checkbox']),
  label: z.string().max(200),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(30).optional(), // select/radio/checkbox
})

const Form = z.object({
  type: z.literal('form'),
  id: z.string().max(80),
  submitLabel: z.string().max(80).optional(),
  fields: z.array(Field).min(1).max(20),
})

export const BlockSchema = z.discriminatedUnion('type', [
  Markdown,
  Progress,
  KeyValue,
  Table,
  Link,
  Img,
  Code,
  Callout,
  Buttons,
  Form,
])

export const BlocksSchema = z.array(BlockSchema).max(50)

export type Block = z.infer<typeof BlockSchema>

const INTERACTIVE = new Set(['buttons', 'form'])

export function hasInteractive(blocks: Block[]): boolean {
  return blocks.some((b) => INTERACTIVE.has(b.type))
}

// Collect the ids an answer is expected to carry, so we can validate a
// submitted answer against the question's own blocks.
export function answerTargets(blocks: Block[]): { buttons: string[]; forms: { id: string; fieldIds: string[] }[] } {
  const buttons: string[] = []
  const forms: { id: string; fieldIds: string[] }[] = []
  for (const b of blocks) {
    if (b.type === 'buttons') buttons.push(b.id)
    if (b.type === 'form') forms.push({ id: b.id, fieldIds: b.fields.map((f) => f.id) })
  }
  return { buttons, forms }
}
