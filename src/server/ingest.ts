import type { AgentEvent } from './events'

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Hash both sides first so the lengths match, then compare in constant time.
export async function tokenMatches(given: string, expected: string): Promise<boolean> {
  if (!expected) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  // timingSafeEqual is a Workers extension, missing from the DOM SubtleCrypto type.
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(a, b)
}

// Events are stored in order; a write's candidate influence set is every
// input event earlier in the same session.
export async function ingest(db: D1Database, events: AgentEvent[]): Promise<string[]> {
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  const writeIds: string[] = []

  for (const e of sorted) {
    await db
      .prepare('INSERT OR IGNORE INTO sessions (id, agent, cwd, started_at) VALUES (?, ?, ?, ?)')
      .bind(e.session_id, e.agent, e.cwd ?? null, e.ts)
      .run()

    const id = crypto.randomUUID()

    if (e.kind === 'input') {
      await db
        .prepare(
          `INSERT INTO context_events (id, session_id, ts, source, source_ref, trust, content, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, e.session_id, e.ts, e.source, e.source_ref ?? null, e.trust, e.content, await sha256(e.content))
        .run()
      continue
    }

    const prior = await db
      .prepare('SELECT id FROM context_events WHERE session_id = ? AND ts <= ? ORDER BY ts')
      .bind(e.session_id, e.ts)
      .all<{ id: string }>()
    await db
      .prepare(
        `INSERT INTO write_events (id, session_id, ts, file_path, old_text, new_text, context_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, e.session_id, e.ts, e.file_path, e.old_text, e.new_text, JSON.stringify(prior.results.map((r) => r.id)))
      .run()
    writeIds.push(id)
  }

  return writeIds
}
