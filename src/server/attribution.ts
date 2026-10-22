import { judge } from './attribution/judge'
import { type ContextInput, overlap, type Verdict, worst } from './attribution/overlap'

type WriteRow = {
  id: string
  session_id: string
  file_path: string
  old_text: string
  new_text: string
  context_ids: string
}

function judgeEnabled(env: Env) {
  return String(env.JUDGE_ENABLED) === 'true' && !!env.OPENROUTER_API_KEY
}

async function attributeOne(env: Env, w: WriteRow) {
  const ids = JSON.parse(w.context_ids) as string[]
  const contexts: ContextInput[] = []
  // D1 caps bound parameters per statement, so fetch in chunks.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const rows = await env.DB.prepare(
      `SELECT id, source, source_ref, trust, content FROM context_events WHERE id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<ContextInput>()
    contexts.push(...rows.results)
  }

  const findings = overlap(w, contexts)
  const stmts = [
    env.DB.prepare('DELETE FROM attributions WHERE write_id = ?').bind(w.id),
    ...findings.map((f) =>
      env.DB.prepare(
        'INSERT INTO attributions (write_id, context_id, method, confidence, reason, verdict) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(w.id, f.context_id, 'overlap', f.confidence, `${f.reason} | "${f.fragment}"`, f.verdict),
    ),
  ]
  let verdict: Verdict = worst(findings.map((f) => f.verdict))

  // The judge only runs when the session had untrusted input, and its verdict
  // wins because it sees the overlap hints plus the meaning of the text.
  if (judgeEnabled(env) && contexts.some((c) => c.trust === 'untrusted')) {
    const result = await judge(env.OPENROUTER_API_KEY, w, contexts, findings)
    if (result) {
      verdict = result.verdict
      for (const f of result.findings) {
        stmts.push(
          env.DB.prepare(
            'INSERT INTO attributions (write_id, context_id, method, confidence, reason, verdict) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind(w.id, f.context_id, 'llm', f.confidence, f.reason, f.verdict),
        )
      }
    }
  }

  stmts.push(
    env.DB.prepare('UPDATE write_events SET verdict = ?, attributed_at = ? WHERE id = ?').bind(verdict, Date.now(), w.id),
  )
  await env.DB.batch(stmts)
}

export async function attributeWrites(env: Env, writeIds: string[]): Promise<void> {
  for (const id of writeIds) {
    try {
      const w = await env.DB.prepare(
        'SELECT id, session_id, file_path, old_text, new_text, context_ids FROM write_events WHERE id = ?',
      )
        .bind(id)
        .first<WriteRow>()
      if (w) await attributeOne(env, w)
    } catch (err) {
      console.error('attribution failed for %s', id, err)
    }
  }
}

export async function attributeSession(env: Env, sessionId: string): Promise<number> {
  const rows = await env.DB.prepare('SELECT id FROM write_events WHERE session_id = ? ORDER BY ts')
    .bind(sessionId)
    .all<{ id: string }>()
  await attributeWrites(
    env,
    rows.results.map((r) => r.id),
  )
  return rows.results.length
}
