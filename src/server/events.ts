// Shared event format sent by the pi extension.

export const TRUST_LEVELS = ['trusted', 'semi', 'untrusted'] as const
export type Trust = (typeof TRUST_LEVELS)[number]

export const MAX_CONTENT_BYTES = 20 * 1024
export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_EVENTS_PER_REQUEST = 200

type BaseEvent = {
  agent: string
  session_id: string
  ts: number
  cwd?: string
  source: string
  source_ref?: string
}

export type InputEvent = BaseEvent & {
  kind: 'input'
  trust: Trust
  content: string
}

export type WriteEvent = BaseEvent & {
  kind: 'write'
  file_path: string
  old_text: string
  new_text: string
}

export type AgentEvent = InputEvent | WriteEvent

export type ParseResult =
  | { ok: true; events: AgentEvent[] }
  | { ok: false; error: string }

function str(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max
}

// Server-side cap as well, in case an adapter forgets to truncate.
function cap(s: string): string {
  return s.length > MAX_CONTENT_BYTES ? s.slice(0, MAX_CONTENT_BYTES) : s
}

function parseOne(raw: unknown, i: number): AgentEvent | string {
  if (typeof raw !== 'object' || raw === null) return `event ${i}: not an object`
  const e = raw as Record<string, unknown>

  if (!str(e.agent, 64) || !e.agent) return `event ${i}: agent`
  if (!str(e.session_id, 128) || !e.session_id) return `event ${i}: session_id`
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return `event ${i}: ts`
  if (!str(e.source, 128) || !e.source) return `event ${i}: source`
  if (e.source_ref !== undefined && !str(e.source_ref, 2048)) return `event ${i}: source_ref`
  if (e.cwd !== undefined && !str(e.cwd, 1024)) return `event ${i}: cwd`

  const base: BaseEvent = {
    agent: e.agent,
    session_id: e.session_id,
    ts: Math.trunc(e.ts),
    cwd: e.cwd as string | undefined,
    source: e.source,
    source_ref: e.source_ref as string | undefined,
  }

  if (e.kind === 'input') {
    if (!TRUST_LEVELS.includes(e.trust as Trust)) return `event ${i}: trust`
    if (typeof e.content !== 'string') return `event ${i}: content`
    return { ...base, kind: 'input', trust: e.trust as Trust, content: cap(e.content) }
  }

  if (e.kind === 'write') {
    if (!str(e.file_path, 2048) || !e.file_path) return `event ${i}: file_path`
    if (typeof e.old_text !== 'string') return `event ${i}: old_text`
    if (typeof e.new_text !== 'string') return `event ${i}: new_text`
    return {
      ...base,
      kind: 'write',
      file_path: e.file_path,
      old_text: cap(e.old_text),
      new_text: cap(e.new_text),
    }
  }

  return `event ${i}: kind must be "input" or "write"`
}

// Accepts one event or an array (the importer and queue flush send batches).
export function parseEvents(body: unknown): ParseResult {
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0) return { ok: false, error: 'no events' }
  if (list.length > MAX_EVENTS_PER_REQUEST) return { ok: false, error: 'too many events' }

  const events: AgentEvent[] = []
  for (const [i, raw] of list.entries()) {
    const parsed = parseOne(raw, i)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    events.push(parsed)
  }
  return { ok: true, events }
}
