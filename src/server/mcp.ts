import type { Env } from './env'
import { json } from './util'
import { createEvent, createQuestion, getQuestion } from './api'

// ── Stateless MCP over Streamable HTTP ───────────────────────────────────────
// A plain JSON-RPC POST handler — NOT Cloudflare's McpAgent (which is a Durable
// Object and would make a DO mandatory). Our tools are pure request/response
// with no session state, so a stateless endpoint is all we need and it keeps
// the whole app free-plan simple. Auth: the same bearer AGENT_KEY.

const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'notify',
    description:
      'Push an update to the human. Use for milestones, not every step (e.g. "Finished scraping 14 sources", "Deploy succeeded"). Set priority 2 for anything that should ring through quiet hours. blocks is an optional array of display blocks (markdown, progress, keyvalue, table, link, code, callout).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short headline shown in the notification.' },
        blocks: { type: 'array', description: 'Optional display blocks. See /api/v1/schema.json.' },
        priority: { type: 'number', description: '0 info, 1 notify, 2 urgent. Default 0.' },
        task_id: { type: 'string', description: 'Group related updates into one thread.' },
        agent: { type: 'string', description: 'Label for who is sending (e.g. "claude-code").' },
      },
      required: ['title'],
    },
  },
  {
    name: 'ask',
    description:
      'Ask the human a question and get an id to poll. Provide at least one interactive block: a "buttons" block for a choice, or a "form" block to collect fields. Returns { id }. Then call wait_for_answer with that id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        blocks: {
          type: 'array',
          description:
            'Must include a buttons or form block. e.g. [{"type":"markdown","text":"Ready to send?"},{"type":"buttons","id":"go","options":["Send","Hold"]}]',
        },
        timeout_minutes: { type: 'number', description: 'How long to wait before the question expires. Default 1440 (24h).' },
        task_id: { type: 'string' },
        agent: { type: 'string' },
      },
      required: ['title', 'blocks'],
    },
  },
  {
    name: 'wait_for_answer',
    description:
      'Check whether the human answered a question. Returns { status: "pending" | "answered" | "expired", answer }. While status is "pending", wait ~10 seconds and call again. When "answered", answer holds the values keyed by each block id. When "expired", proceed with a sensible default.',
    inputSchema: {
      type: 'object',
      properties: { question_id: { type: 'string' } },
      required: ['question_id'],
    },
  },
]

// Adapt an existing API handler (which speaks Request/Response) to a tool call
// by synthesizing a Request from the tool arguments.
function fakeRequest(body: unknown): Request {
  return new Request('https://mcp.local/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

async function callTool(name: string, args: Record<string, unknown>, env: Env): Promise<unknown> {
  if (name === 'notify') {
    const res = await createEvent(fakeRequest({ ...args, kind: 'update' }), env)
    return res.json()
  }
  if (name === 'ask') {
    const res = await createQuestion(fakeRequest(args), env)
    return res.json()
  }
  if (name === 'wait_for_answer') {
    const id = String(args.question_id ?? '')
    const res = await getQuestion(id, env)
    return res.json()
  }
  throw new Error(`Unknown tool: ${name}`)
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    // Some clients probe with GET; advertise that we speak JSON-RPC over POST.
    return json({ ok: true, transport: 'streamable-http', protocol: PROTOCOL_VERSION })
  }

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    msg = (await request.json()) as typeof msg
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400)
  }

  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      return json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-dash', version: '0.1.0' },
        }),
      )
    case 'notifications/initialized':
      return new Response(null, { status: 202 })
    case 'tools/list':
      return json(rpcResult(id, { tools: TOOLS }))
    case 'tools/call': {
      const toolName = String(params?.name ?? '')
      const args = (params?.arguments ?? {}) as Record<string, unknown>
      try {
        const out = await callTool(toolName, args, env)
        return json(
          rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(out) }],
          }),
        )
      } catch (e) {
        return json(rpcResult(id, {
          content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
          isError: true,
        }))
      }
    }
    case 'ping':
      return json(rpcResult(id, {}))
    default:
      return json(rpcError(id, -32601, `Method not found: ${method}`))
  }
}
