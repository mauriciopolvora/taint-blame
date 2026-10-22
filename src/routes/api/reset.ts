import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { tokenMatches } from '#/server/ingest'

// Deletes one session ({ session_id }) or every session ({}), children first.
export const Route = createFileRoute('/api/reset')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization') ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (!(await tokenMatches(token, env.INGEST_TOKEN))) {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as { session_id?: unknown } | null
        if (!body || typeof body !== 'object') {
          return Response.json({ error: 'body required' }, { status: 400 })
        }
        const id = body.session_id
        if (id !== undefined && (typeof id !== 'string' || !id || id.length > 128)) {
          return Response.json({ error: 'session_id must be a string up to 128 chars' }, { status: 400 })
        }

        const db = env.DB
        if (typeof id === 'string') {
          const results = await db.batch([
            db.prepare('DELETE FROM attributions WHERE write_id IN (SELECT id FROM write_events WHERE session_id = ?)').bind(id),
            db.prepare('DELETE FROM write_events WHERE session_id = ?').bind(id),
            db.prepare('DELETE FROM context_events WHERE session_id = ?').bind(id),
            db.prepare('DELETE FROM sessions WHERE id = ?').bind(id),
          ])
          const sessions = results[3].meta.changes
          if (!sessions) return Response.json({ error: 'not found' }, { status: 404 })
          return Response.json({ ok: true, sessions })
        }

        const results = await db.batch([
          db.prepare('DELETE FROM attributions'),
          db.prepare('DELETE FROM write_events'),
          db.prepare('DELETE FROM context_events'),
          db.prepare('DELETE FROM sessions'),
        ])
        return Response.json({ ok: true, sessions: results[3].meta.changes })
      },
    },
  },
})
