// Thin client-side fetch helpers. Same-origin, cookie-authed.

export interface QuestionState {
  status: 'pending' | 'answered' | 'expired'
  answer: Record<string, unknown> | null
  timeout_at: number
}

export interface EventItem {
  id: string
  agent: string
  task_id: string | null
  kind: 'update' | 'question' | 'done' | 'error'
  title: string
  blocks: unknown[]
  priority: number
  created_at: number
  updated_at: number
  read_at: number | null
  question: QuestionState | null
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  if (res.status === 401) throw new AuthError()
  return res.json() as Promise<T>
}

export class AuthError extends Error {
  constructor() {
    super('unauthorized')
  }
}

export const api = {
  feed: (sinceTs?: number) =>
    req<{ ok: boolean; events: EventItem[] }>(
      `/api/v1/feed${sinceTs ? `?since_ts=${sinceTs}` : ''}`,
    ),
  event: (id: string) => req<{ ok: boolean; event: EventItem }>(`/api/v1/event/${id}`),
  stats: () => req<{ ok: boolean; unread: number; pending_questions: number }>('/api/v1/stats'),
  markRead: (id: string) => req(`/api/v1/event/${id}/read`, { method: 'POST' }),
  markAllRead: () => req('/api/v1/read-all', { method: 'POST' }),
  answer: (id: string, answer: Record<string, unknown>) =>
    req<{ ok: boolean; error?: string }>(`/api/v1/questions/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify(answer),
    }),
  settings: () => req<{ ok: boolean; quiet_hours: unknown }>('/api/v1/settings'),
  putSettings: (body: unknown) =>
    req('/api/v1/settings', { method: 'POST', body: JSON.stringify(body) }),
  vapid: () => req<{ ok: boolean; key: string }>('/api/v1/push/vapid'),
  subscribePush: (sub: unknown) =>
    req('/api/v1/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribePush: (endpoint: string) =>
    req('/api/v1/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  logout: () => req('/api/logout', { method: 'POST' }),
  logoutAll: () => req('/api/logout-all', { method: 'POST' }),
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
