import type { Env } from './env'
import { json } from './util'
import { createEvent, updateEvent, createQuestion, getQuestion, clearEvents } from './api'

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
      'Push an update to the human. Use for milestones, not every step. ALWAYS pass: project (what you are working on), model (which LLM you are), and task_id — generate ONE stable task_id when you start a task and reuse it on EVERY notify/ask for that task, so all its messages thread together in one conversation instead of scattering into separate cards. Set priority 2 for anything that should ring through quiet hours.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short headline / the message itself.' },
        project: { type: 'string', description: 'Project name, e.g. "Weather app". Used to group and filter.' },
        task: { type: 'string', description: 'Current task, e.g. "Adding children mode".' },
        model: { type: 'string', description: 'Which model you are, e.g. "claude-opus-4.8", "gpt-5".' },
        tags: { type: 'array', description: 'Optional freeform tags, e.g. ["backend","urgent"].' },
        blocks: { type: 'array', description: 'Optional display blocks. See /api/v1/schema.json.' },
        priority: { type: 'number', description: '0 info, 1 notify, 2 urgent. Default 0.' },
        task_id: { type: 'string', description: 'Stable key to group updates into one thread / update in place.' },
        agent: { type: 'string', description: 'The tool/client you run in (e.g. "claude-code", "cursor").' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update',
    description:
      'Update an existing event in place — the way to send LIVE progress. First call notify to create the event and keep its returned id; then call update repeatedly with new blocks (e.g. a progress block going 0→50→100) to move the same card without spamming new rows. Set notify:true on the final call to push a "done" notification.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The id returned by notify.' },
        title: { type: 'string' },
        blocks: { type: 'array', description: 'New display blocks (replaces the old ones).' },
        kind: { type: 'string', description: 'update | done | error' },
        priority: { type: 'number' },
        notify: { type: 'boolean', description: 'Send a push for this update. Default false — leave off for silent progress ticks.' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'ask',
    description:
      'Ask the human a question and get an id to poll. Provide at least one interactive block: a "buttons" block for a choice, or a "form" block to collect fields. ALWAYS pass project, model, task (the sub-task name), and — critically — the SAME task_id you use for this task\'s other calls, so a sequence of questions (Q1 → answer → Q2 → answer) stacks into one thread instead of separate cards. Returns { id }; then call wait_for_answer. Use ask for each DISTINCT step; use update (not ask) when a single status like a progress bar should change in place.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The question, e.g. "Which color scheme?"' },
        project: { type: 'string', description: 'Project name, e.g. "Weather app".' },
        task: { type: 'string', description: 'Current task, e.g. "Adding children mode".' },
        model: { type: 'string', description: 'Which model you are.' },
        tags: { type: 'array', description: 'Optional freeform tags.' },
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
    name: 'clear',
    description:
      "Tidy the human's inbox when it's getting cluttered. scope 'read' (the safe default) removes only items they've already seen or answered, keeping anything unread or awaiting an answer. scope 'all' wipes everything — only use 'all' when the human explicitly asked to restart. Optionally limit to one project.",
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: "'read' (default, safe) or 'all' (full reset)." },
        project: { type: 'string', description: 'Only clear this project.' },
      },
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
  if (name === 'update') {
    const { event_id, ...rest } = args
    const res = await updateEvent(String(event_id ?? ''), fakeRequest(rest), env)
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
  if (name === 'clear') {
    const scope = args.scope === 'all' ? 'all' : 'read'
    const res = await clearEvents(env, scope, typeof args.project === 'string' ? args.project : undefined)
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
