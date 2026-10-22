import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { changedLines } from '#/components/diff'

// Read-only queries for the dashboard. Shapes are plain JSON so they
// serialize through route loaders.

export type Verdict = 'green' | 'amber' | 'red'
export type Trust = 'trusted' | 'semi' | 'untrusted'

export type SessionSummary = {
  id: string
  agent: string
  cwd: string | null
  started_at: number
  inputs: number
  untrusted_inputs: number
  writes: number
  red: number
  amber: number
  green: number
  pending: number
  changed_lines: number
  influenced_lines: number
  // changed lines per verdict (pending = verdict null)
  lines: Record<Verdict | 'pending', number>
}

export type ContextEvent = {
  id: string
  ts: number
  source: string
  source_ref: string | null
  trust: Trust
  content: string
}

export type Attribution = {
  context_id: string
  method: 'overlap' | 'llm'
  confidence: number
  reason: string | null
  verdict: Verdict
}

export type WriteEvent = {
  id: string
  ts: number
  file_path: string
  old_text: string
  new_text: string
  context_ids: string[]
  verdict: Verdict | null
  attributed_at: number | null
  attributions: Attribution[]
}

export type SessionDetail = {
  session: { id: string; agent: string; cwd: string | null; started_at: number }
  contexts: ContextEvent[]
  writes: WriteEvent[]
}

const isInfluenced = (v: string | null) => v === 'red' || v === 'amber'

export const listSessions = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionSummary[]> => {
  const db = env.DB
  const [sessions, ctx, writes] = await db.batch([
    db.prepare('SELECT id, agent, cwd, started_at FROM sessions ORDER BY started_at DESC LIMIT 200'),
    db.prepare(
      `SELECT session_id, COUNT(*) AS inputs, SUM(trust = 'untrusted') AS untrusted
       FROM context_events GROUP BY session_id`,
    ),
    db.prepare('SELECT session_id, verdict, new_text FROM write_events'),
  ])

  const ctxBy = new Map<string, { inputs: number; untrusted: number }>()
  for (const r of ctx.results as { session_id: string; inputs: number; untrusted: number }[]) {
    ctxBy.set(r.session_id, { inputs: r.inputs, untrusted: r.untrusted ?? 0 })
  }

  const out = new Map<string, SessionSummary>()
  for (const s of sessions.results as { id: string; agent: string; cwd: string | null; started_at: number }[]) {
    const c = ctxBy.get(s.id)
    out.set(s.id, {
      ...s,
      inputs: c?.inputs ?? 0,
      untrusted_inputs: c?.untrusted ?? 0,
      writes: 0,
      red: 0,
      amber: 0,
      green: 0,
      pending: 0,
      changed_lines: 0,
      influenced_lines: 0,
      lines: { red: 0, amber: 0, green: 0, pending: 0 },
    })
  }
  for (const w of writes.results as { session_id: string; verdict: Verdict | null; new_text: string }[]) {
    const s = out.get(w.session_id)
    if (!s) continue
    const lines = changedLines(w.new_text)
    s.writes++
    s.changed_lines += lines
    if (isInfluenced(w.verdict)) s.influenced_lines += lines
    const k = w.verdict === 'red' || w.verdict === 'amber' || w.verdict === 'green' ? w.verdict : 'pending'
    s[k]++
    s.lines[k] += lines
  }
  return [...out.values()]
})

export const getSession = createServerFn({ method: 'GET' })
  .validator((id: unknown) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new Error('invalid session id')
    return id
  })
  .handler(async ({ data: id }): Promise<SessionDetail | null> => {
    const db = env.DB
    const [sess, ctx, writes, attrs] = await db.batch([
      db.prepare('SELECT id, agent, cwd, started_at FROM sessions WHERE id = ?').bind(id),
      db
        .prepare('SELECT id, ts, source, source_ref, trust, content FROM context_events WHERE session_id = ? ORDER BY ts, id')
        .bind(id),
      db
        .prepare(
          `SELECT id, ts, file_path, old_text, new_text, context_ids, verdict, attributed_at
           FROM write_events WHERE session_id = ? ORDER BY ts, id`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT a.write_id, a.context_id, a.method, a.confidence, a.reason, a.verdict
           FROM attributions a JOIN write_events w ON w.id = a.write_id
           WHERE w.session_id = ?
           ORDER BY a.confidence DESC`,
        )
        .bind(id),
    ])

    const session = sess.results[0] as SessionDetail['session'] | undefined
    if (!session) return null

    const attrBy = new Map<string, Attribution[]>()
    for (const a of attrs.results as (Attribution & { write_id: string })[]) {
      const { write_id, ...rest } = a
      const list = attrBy.get(write_id) ?? []
      list.push(rest)
      attrBy.set(write_id, list)
    }

    return {
      session,
      contexts: ctx.results as ContextEvent[],
      writes: (writes.results as (Omit<WriteEvent, 'context_ids' | 'attributions'> & { context_ids: string })[]).map(
        (w) => ({
          ...w,
          context_ids: parseIds(w.context_ids),
          attributions: attrBy.get(w.id) ?? [],
        }),
      ),
    }
  })

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
