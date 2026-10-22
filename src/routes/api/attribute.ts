import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { attributeSession } from '#/server/attribution'
import { tokenMatches } from '#/server/ingest'

// Re-runs attribution for a whole session, e.g. after enabling the judge.
export const Route = createFileRoute('/api/attribute')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization') ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (!(await tokenMatches(token, env.INGEST_TOKEN))) {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as { session_id?: unknown } | null
        if (typeof body?.session_id !== 'string' || body.session_id.length > 128) {
          return Response.json({ error: 'session_id required' }, { status: 400 })
        }
        const writes = await attributeSession(env, body.session_id)
        return Response.json({ ok: true, writes })
      },
    },
  },
})
