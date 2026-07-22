import { useEffect, useState } from 'react'
import { createFileRoute, useParams, useNavigate, Link } from '@tanstack/react-router'
import { api, AuthError } from '../lib/api'
import { Container, LockedScreen, Spinner } from '../lib/shell'
import { toParam } from '../lib/project'

// Push notifications deep-link here (/event/:id). We resolve the event to its
// thread and redirect, so a notification lands inside the task conversation.
export const Route = createFileRoute('/event/$id')({
  component: EventRedirect,
  ssr: false,
})

function EventRedirect() {
  const { id } = useParams({ from: '/event/$id' })
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'locked' | 'notfound'>('loading')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await api.event(id)
        if (!res.ok || !res.event) {
          setState('notfound')
          return
        }
        const e = res.event
        const key = e.task_id && e.task_id.trim() ? e.task_id : e.id
        navigate({
          to: '/project/$name/task/$key',
          params: { name: toParam(e.project ?? ''), key },
          replace: true,
        })
      } catch (err) {
        if (err instanceof AuthError) setState('locked')
        else setState('notfound')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (state === 'locked') return <LockedScreen />
  if (state === 'notfound')
    return (
      <Container>
        <p style={{ color: 'var(--muted)', padding: '2rem 0' }}>This message no longer exists.</p>
        <Link to="/">← Back to projects</Link>
      </Container>
    )
  return <Spinner />
}
