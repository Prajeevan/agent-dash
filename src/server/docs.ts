import { json } from './util'

// Human/agent-readable description of the block contract. Served at
// /api/v1/schema.json and linked from the skill + MCP tool descriptions.
export function blockSchemaDoc(): Response {
  return json(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Agent Dash blocks',
      description:
        'A JSON array of typed UI blocks. Display blocks work in any event. Interactive blocks (buttons, form) are only valid on a question.',
      blocks: {
        markdown: { type: 'markdown', text: 'string (GitHub-flavored markdown)' },
        progress: { type: 'progress', label: 'string?', value: 'number', max: 'number (default 100)' },
        keyvalue: { type: 'keyvalue', items: '[{ k: string, v: string }]' },
        table: { type: 'table', columns: 'string[]', rows: 'string[][]' },
        link: { type: 'link', url: 'string(url)', label: 'string?' },
        image: { type: 'image', url: 'string(url)', alt: 'string?' },
        code: { type: 'code', lang: 'string?', text: 'string' },
        callout: { type: 'callout', tone: 'info|success|warn|error', text: 'string' },
        buttons: { type: 'buttons', id: 'string', options: 'string[] (the choices)' },
        form: {
          type: 'form',
          id: 'string',
          submitLabel: 'string?',
          fields:
            '[{ id: string, kind: "text|textarea|number|select|radio|checkbox", label: string, options?: string[], required?: boolean, placeholder?: string }]',
        },
      },
      examples: {
        update: [
          { type: 'markdown', text: '## Research complete\nFound 14 competitors.' },
          { type: 'progress', label: 'Sources scraped', value: 14, max: 14 },
        ],
        question_form: [
          { type: 'markdown', text: 'Ready to draft the deck. A few choices:' },
          {
            type: 'form',
            id: 'deck',
            submitLabel: 'Build it',
            fields: [
              { id: 'audience', kind: 'select', label: 'Audience', options: ['VC', 'Customer', 'Internal'] },
              { id: 'tone', kind: 'radio', label: 'Tone', options: ['Formal', 'Punchy'] },
              { id: 'notes', kind: 'textarea', label: 'Anything to emphasize?' },
            ],
          },
        ],
        question_buttons: [
          { type: 'markdown', text: 'About to deploy to production. Go?' },
          { type: 'buttons', id: 'confirm', options: ['Deploy', 'Cancel'] },
        ],
      },
    },
    200,
    { 'access-control-allow-origin': '*' },
  )
}

export function openApiDoc(origin: string): Response {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Agent Dash',
      version: '0.1.0',
      description:
        'Push updates and ask-and-wait questions from AI agents to one human. Bearer auth with your AGENT_KEY.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }],
    paths: {
      '/api/v1/events': {
        post: {
          operationId: 'notify',
          summary: 'Push an update notification.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    agent: { type: 'string' },
                    task_id: { type: 'string' },
                    priority: { type: 'integer', enum: [0, 1, 2] },
                    blocks: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Created', content: { 'application/json': {} } } },
        },
      },
      '/api/v1/questions': {
        post: {
          operationId: 'ask',
          summary: 'Ask a question (must include a buttons or form block).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'blocks'],
                  properties: {
                    title: { type: 'string' },
                    blocks: { type: 'array', items: { type: 'object' } },
                    timeout_minutes: { type: 'integer' },
                    task_id: { type: 'string' },
                    agent: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Created; returns id + poll_url' } },
        },
      },
      '/api/v1/questions/{id}': {
        get: {
          operationId: 'wait_for_answer',
          summary: 'Poll for the answer. Repeat every ~10s while status is pending.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'status: pending | answered | expired' } },
        },
      },
      '/api/v1/inbox': {
        get: {
          operationId: 'inbox',
          summary: 'List recent events (dedupe / resume).',
          parameters: [
            { name: 'agent', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Recent events' } },
        },
      },
    },
  }
  return json(spec, 200, { 'access-control-allow-origin': '*' })
}
