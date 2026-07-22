import startEntry from '@tanstack/react-start/server-entry'
import type { Env } from './server/env'
import { json } from './server/util'
import {
  isAgentAuthed,
  isLoggedIn,
  verifyLoginToken,
  createSession,
  sessionCookie,
  clearCookie,
  destroySession,
  bumpEpoch,
} from './server/auth'
import {
  createEvent,
  createQuestion,
  getQuestion,
  getInbox,
  getFeed,
  getEvent,
  markRead,
  markAllRead,
  answerQuestion,
  subscribePush,
  unsubscribePush,
  getSettings,
  putSettings,
  getStats,
} from './server/api'
import { handleMcp } from './server/mcp'
import { blockSchemaDoc, openApiDoc } from './server/docs'
import { runCron } from './server/cron'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-max-age': '86400',
}

function unauthorized(): Response {
  return json({ ok: false, error: 'Unauthorized.' }, 401)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // ── CORS preflight for bearer-authed agent + doc endpoints ──
    if (method === 'OPTIONS' && path.startsWith('/api/v1/')) {
      return new Response(null, { status: 204, headers: CORS })
    }

    // ── Public docs (agents self-serve the contract) ──
    if (path === '/api/v1/schema.json') return blockSchemaDoc()
    if (path === '/api/v1/openapi.json') return openApiDoc(url.origin)
    // The browser needs the VAPID public key to subscribe — safe to expose.
    if (path === '/api/v1/push/vapid' && method === 'GET') {
      return json({ ok: true, key: env.VAPID_PUBLIC_KEY ?? '' }, 200, CORS)
    }

    // ── MCP (bearer AGENT_KEY) ──
    if (path === '/mcp') {
      if (!isAgentAuthed(request, env)) return unauthorized()
      return handleMcp(request, env)
    }

    // ── Agent API (bearer AGENT_KEY) ──
    if (path.startsWith('/api/v1/')) {
      const agentRoute =
        (path === '/api/v1/events' && method === 'POST') ||
        (path === '/api/v1/questions' && method === 'POST') ||
        (path === '/api/v1/inbox' && method === 'GET') ||
        (/^\/api\/v1\/questions\/[^/]+$/.test(path) && method === 'GET')

      if (agentRoute) {
        if (!isAgentAuthed(request, env)) return withCors(unauthorized())
        if (path === '/api/v1/events') return withCors(await createEvent(request, env))
        if (path === '/api/v1/questions') return withCors(await createQuestion(request, env))
        if (path === '/api/v1/inbox') return withCors(await getInbox(url, env))
        const qid = path.split('/').pop() as string
        return withCors(await getQuestion(qid, env))
      }

      // ── Dashboard API (session cookie) ──
      if (!(await isLoggedIn(request, env))) return unauthorized()

      if (path === '/api/v1/feed' && method === 'GET') return getFeed(url, env)
      if (path === '/api/v1/stats' && method === 'GET') return getStats(env)
      if (path === '/api/v1/settings' && method === 'GET') return getSettings(env)
      if (path === '/api/v1/settings' && method === 'POST') return putSettings(request, env)
      if (path === '/api/v1/read-all' && method === 'POST') return markAllRead(env)
      if (path === '/api/v1/push/subscribe' && method === 'POST') return subscribePush(request, env)
      if (path === '/api/v1/push/unsubscribe' && method === 'POST') return unsubscribePush(request, env)

      const eventMatch = path.match(/^\/api\/v1\/event\/([^/]+)$/)
      if (eventMatch && method === 'GET') return getEvent(eventMatch[1], env)

      const readMatch = path.match(/^\/api\/v1\/event\/([^/]+)\/read$/)
      if (readMatch && method === 'POST') return markRead(readMatch[1], env)

      const answerMatch = path.match(/^\/api\/v1\/questions\/([^/]+)\/answer$/)
      if (answerMatch && method === 'POST') return answerQuestion(answerMatch[1], request, env)

      return json({ ok: false, error: 'Not found.' }, 404)
    }

    // ── Magic-link login: consume token, set session, redirect to app ──
    if (path === '/login' && method === 'GET') {
      const token = url.searchParams.get('t') ?? ''
      if (!token || !(await verifyLoginToken(env, token))) {
        return htmlResponse(loginErrorPage(), 401)
      }
      const value = await createSession(env)
      return new Response(null, {
        status: 302,
        headers: { location: '/', 'set-cookie': sessionCookie(value, env) },
      })
    }

    // ── Logout (this device) and logout-everywhere ──
    if (path === '/api/logout' && method === 'POST') {
      await destroySession(request, env)
      return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
    }
    if (path === '/api/logout-all' && method === 'POST') {
      if (!(await isLoggedIn(request, env))) return unauthorized()
      await bumpEpoch(env)
      return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
    }

    // ── Everything else → TanStack Start SSR (the dashboard/PWA) ──
    // @ts-expect-error - the default server entry exposes a Cloudflare-style fetch
    return startEntry.fetch(request, env, ctx)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env))
  },
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function loginErrorPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Link expired — Agent Dash</title>
<style>body{margin:0;min-height:100svh;display:flex;align-items:center;justify-content:center;
background:#0a0a0f;color:#e8e8f0;font-family:system-ui,sans-serif;text-align:center;padding:2rem}
.card{max-width:26rem}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#9aa;line-height:1.6}
code{background:#1a1a24;padding:.15rem .4rem;border-radius:.3rem;color:#c9b6ff}</style></head>
<body><div class="card"><h1>This link has expired</h1>
<p>Magic links last 15 minutes. Generate a fresh one from your machine with
<code>pnpm login</code> and open it on this device.</p></div></body></html>`
}
