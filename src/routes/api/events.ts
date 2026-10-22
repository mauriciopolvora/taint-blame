import { createFileRoute } from '@tanstack/react-router'
import { env, waitUntil } from 'cloudflare:workers'
import { attributeWrites } from '#/server/attribution'
import { MAX_BODY_BYTES, parseEvents } from '#/server/events'
import { ingest, tokenMatches } from '#/server/ingest'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization') ?? ''
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (!(await tokenMatches(token, env.INGEST_TOKEN))) {
          return json({ error: 'unauthorized' }, 401)
        }

        const declared = Number(request.headers.get('content-length') ?? 0)
        if (declared > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413)
        const text = await request.text()
        if (text.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413)

        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return json({ error: 'invalid json' }, 400)
        }

        const parsed = parseEvents(body)
        if (!parsed.ok) return json({ error: parsed.error }, 400)

        const writeIds = await ingest(env.DB, parsed.events)
        if (writeIds.length > 0) waitUntil(attributeWrites(env, writeIds))

        return json({ ok: true, received: parsed.events.length, writes: writeIds.length })
      },
    },
  },
})
