import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { tokenMatches } from '#/server/ingest'

// 200 when the bearer token is the ingest token, 401 otherwise.
export const Route = createFileRoute('/api/verify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization') ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (!(await tokenMatches(token, env.INGEST_TOKEN))) {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        return Response.json({ ok: true })
      },
    },
  },
})
