import type { Env } from './env'

// ── Instant mode (opt-in) ────────────────────────────────────────────────────
// A single Durable Object that fans out a "something changed" ping to every
// open dashboard tab over a hibernatable WebSocket. Hibernated sockets don't
// bill duration, so an idle hub costs ~nothing even on the paid plan — and the
// whole thing only runs when INSTANT=1. When off, the app polls (free tier).
//
// We broadcast a tiny {type:'refresh'} signal, not the data — the client then
// refetches. Keeps the DO trivial and avoids duplicating serialization.
export class Hub {
  private state: DurableObjectState
  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 })
      }
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      // Hibernation API: the runtime can evict this DO from memory while the
      // socket stays open, and rehydrate on the next event.
      this.state.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/poke') {
      const msg = JSON.stringify({ type: 'refresh', at: Date.now() })
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(msg)
        } catch {
          /* dead socket; runtime will clean it up */
        }
      }
      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  }

  // Required hibernation handlers. We don't need client messages; a ping keeps
  // the connection warm through proxies.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') {
      try {
        ws.send('pong')
      } catch {
        /* ignore */
      }
    }
  }
  async webSocketClose(ws: WebSocket) {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }
  async webSocketError() {
    /* nothing to do */
  }
}

// Called after any change. No-op unless instant mode is enabled. Each account
// gets its own Durable Object (idFromName(accountId)) so a poke only wakes that
// account's open tabs — never broadcasts across tenants.
export async function pokeHub(env: Env, accountId: string): Promise<void> {
  if (env.INSTANT !== '1' || !env.HUB) return
  try {
    const stub = env.HUB.get(env.HUB.idFromName(accountId))
    await stub.fetch('https://hub.internal/poke')
  } catch {
    /* instant delivery is best-effort; polling still covers it */
  }
}
