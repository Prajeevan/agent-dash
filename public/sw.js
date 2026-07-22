// Agent Dash service worker: receive Web Push, show the notification, and
// deep-link into the relevant event when tapped. Deliberately tiny — no
// offline caching in v1 (the app needs the network to be useful anyway).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'Agent Dash', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Agent Dash'
  const isQuestion = data.kind === 'question'
  const options = {
    body: data.body || '',
    tag: data.tag || data.eventId || 'agent-dash',
    data: { url: data.eventId ? `/event/${data.eventId}` : '/' },
    icon: '/icon-192.png',
    badge: '/badge.png',
    requireInteraction: isQuestion || data.priority >= 2,
    vibrate: isQuestion ? [80, 40, 80] : [40],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
