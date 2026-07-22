import { Link, createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <main
      style={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <p style={{ fontSize: '4rem', fontWeight: 700, color: '#7c5cff', margin: 0 }}>404</p>
      <h1 style={{ margin: 0 }}>Not found</h1>
      <Link to="/" style={{ color: '#7c5cff', fontWeight: 600 }}>
        Back to inbox
      </Link>
    </main>
  )
}

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
