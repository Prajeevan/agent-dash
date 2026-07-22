import { useEffect, useRef } from 'react'

// Live-refresh transport. In instant mode (Pro / INSTANT=1) it holds a
// WebSocket to the Hub Durable Object and refreshes the moment anything
// changes. Otherwise it polls every 5s while the tab is visible. Either way the
// caller just passes its `load` function and forgets about the plumbing.
export function useLive(onRefresh: () => void) {
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    let stopped = false
    let ws: WebSocket | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') cb.current()
    }

    const startPolling = (ms: number) => {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = setInterval(refreshIfVisible, ms)
    }

    const openSocket = () => {
      if (stopped) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`)
      } catch {
        startPolling(5000)
        return
      }
      ws.onmessage = (e) => {
        if (typeof e.data === 'string' && e.data !== 'pong') refreshIfVisible()
      }
      ws.onclose = () => {
        if (stopped) return
        // Fall back to slow polling and try to reconnect.
        reconnect = setTimeout(openSocket, 4000)
      }
      ws.onerror = () => {
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
      }
      // Keep-alive ping so proxies don't drop an idle hibernated socket.
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        try {
          ws?.readyState === WebSocket.OPEN && ws.send('ping')
        } catch {
          /* ignore */
        }
      }, 30_000)
    }

    ;(async () => {
      let instant = false
      try {
        const r = await fetch('/api/v1/config', { credentials: 'same-origin' })
        instant = r.ok && ((await r.json()) as { instant?: boolean }).instant === true
      } catch {
        /* default to polling */
      }
      if (stopped) return
      if (instant) {
        openSocket()
        startPolling(30_000) // safety net behind the socket
      } else {
        startPolling(5000)
      }
    })()

    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      stopped = true
      if (pollTimer) clearInterval(pollTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (reconnect) clearTimeout(reconnect)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }, [])
}
