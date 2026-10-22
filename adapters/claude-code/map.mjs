// Maps one Claude Code tool call (or prompt) to Taint Blame events.
// Shared by the live hook (hook.mjs) and the transcript importer (../import.mjs),
// so both label sources and trust identically.
//
// Shapes verified against Claude Code 2.1.306 hook payloads (see fixtures/):
//   Read      tool_input.file_path          tool_response.file.content
//   Bash      tool_input.command            tool_response.stdout / .stderr
//   WebFetch  tool_input.url                tool_response.result (the summarized page)
//   WebSearch tool_input.query              tool_response.results[] (strings + {content:[{title,url}]})
//   Agent     tool_input.subagent_type      tool_response.content[] text blocks
//   mcp__*    tool_input                    tool_response: string or content blocks
//   Edit      old_string / new_string
//   Write     content; tool_response.originalFile is the previous content (null on create)
//   MultiEdit edits[] of { old_string, new_string }
// The transcript's `toolUseResult` field has the same shape as `tool_response`.

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { clean, fileTrust, redact } from '../shared/client.mjs'

export const AGENT = 'claude-code'
const MAX_REF = 2048
const MAX_CWD = 1024
// Server rejects bodies over 1 MB; stay well under it.
const MAX_BATCH_BYTES = 900 * 1024

// Trust is judged against the repo root, not the (possibly nested) cwd.
const rootCache = new Map()
export function repoRoot(cwd) {
  if (!cwd) return cwd
  if (rootCache.has(cwd)) return rootCache.get(cwd)
  let dir = cwd
  let found = cwd
  for (;;) {
    if (existsSync(join(dir, '.git'))) { found = dir; break }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  rootCache.set(cwd, found)
  return found
}

function inRepo(path, cwd) {
  if (!path) return true
  const root = repoRoot(cwd)
  const abs = isAbsolute(path) ? path : resolve(cwd || '.', path)
  const rel = relative(root, abs)
  return !(rel.startsWith('..') || isAbsolute(rel))
}

function ref(s) {
  if (s === undefined || s === null || s === '') return undefined
  const r = redact(String(s))
  return r.length > MAX_REF ? r.slice(0, MAX_REF - 1) + '…' : r
}

// Best-effort plain text from any tool result shape.
export function toText(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('\n')
  if (typeof v === 'object') {
    if (v.type === 'text' && typeof v.text === 'string') return v.text
    if (v.type === 'image' || v.type === 'tool_reference') return ''
    if (v.title && v.url) return `${v.title} <${v.url}>`
    if (v.file && typeof v.file === 'object') return toText(v.file.content ?? '')
    if ('stdout' in v || 'stderr' in v) return [v.stdout, v.stderr].filter(Boolean).join('\n')
    if (typeof v.result === 'string') return v.result
    if (v.results) return toText(v.results)
    if (v.content !== undefined) return toText(v.content)
    if (Array.isArray(v.filenames)) return v.filenames.join('\n')
    if (typeof v.output === 'string') return v.output
    try { return JSON.stringify(v) } catch { return '' }
  }
  return String(v)
}

// ctx: { session_id, cwd, ts }
// Returns an array of events (possibly empty). `fallbackText` is used when the
// structured response is missing (older transcripts without toolUseResult).
export function toolEvents(ctx, toolName, input = {}, response, fallbackText) {
  const { session_id, ts } = ctx
  const cwd = ctx.cwd && ctx.cwd.length <= MAX_CWD ? ctx.cwd : undefined
  const base = { agent: AGENT, session_id, cwd }
  input = input && typeof input === 'object' ? input : {}
  const text = () => (response !== undefined && response !== null ? toText(response) : toText(fallbackText))
  const inp = (source, trust, content, source_ref, path) => [{
    ...base, ts, kind: 'input', source, trust, content: clean(content, path), ...(source_ref ? { source_ref } : {}),
  }]
  const wr = (source, file_path, old_text, new_text, t = ts) => ({
    ...base, ts: t, kind: 'write', source, file_path: String(file_path),
    old_text: clean(old_text ?? '', file_path), new_text: clean(new_text ?? '', file_path),
  })

  if (toolName.startsWith('mcp__')) {
    return inp(`mcp:${toolName.slice(5)}`, 'untrusted', text(), ref(safeJson(input)))
  }

  switch (toolName) {
    case 'Read': {
      const p = input.file_path ?? response?.file?.filePath
      let content = response?.file?.content
      if (typeof content !== 'string') content = response ? text() : stripLineNumbers(toText(fallbackText))
      return inp('read', fileTrust(p, repoRoot(ctx.cwd)), content, ref(p), p)
    }
    case 'Bash':
      return inp('bash', 'untrusted', text(), ref(input.command))
    case 'Grep':
      return inp('grep', inRepo(input.path, ctx.cwd) ? 'semi' : 'untrusted', text(), ref([input.pattern, input.path].filter(Boolean).join(' in ')))
    case 'Glob':
      return inp('glob', inRepo(input.path, ctx.cwd) ? 'semi' : 'untrusted', text(), ref([input.pattern, input.path].filter(Boolean).join(' in ')))
    case 'WebFetch':
      return inp('web_fetch', 'untrusted', text(), ref(input.url ?? response?.url))
    case 'WebSearch':
      return inp('web_search', 'untrusted', text(), ref(input.query))
    case 'Task':
    case 'Agent':
      return inp('task', 'untrusted', text(), ref(input.subagent_type || input.description))
    case 'Edit':
      return [wr('edit', input.file_path, input.old_string, input.new_string)]
    case 'Write': {
      const prev = response && typeof response.originalFile === 'string' ? response.originalFile : ''
      return [wr('write', input.file_path, prev, input.content)]
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : []
      return edits.map((e, i) => wr('multiedit', input.file_path, e?.old_string, e?.new_string, ts + i))
    }
    case 'NotebookEdit': {
      const p = input.notebook_path
      if (!p) return []
      const old = response && typeof response.original_file === 'string' ? response.original_file : ''
      return [wr('notebook_edit', p, input.edit_mode === 'insert' ? '' : old, input.new_source)]
    }
    default:
      return []
  }
}

export function promptEvent(ctx, prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return []
  const cwd = ctx.cwd && ctx.cwd.length <= MAX_CWD ? ctx.cwd : undefined
  return [{ agent: AGENT, session_id: ctx.session_id, cwd, ts: ctx.ts, kind: 'input', source: 'user_prompt', trust: 'trusted', content: clean(prompt) }]
}

// Split events into POST-sized batches (<= max events and <= ~900 KB each).
export function batches(events, max = 100) {
  const out = []
  let cur = []
  let bytes = 0
  for (const e of events) {
    const size = Buffer.byteLength(JSON.stringify(e)) + 1
    if (cur.length && (cur.length >= max || bytes + size > MAX_BATCH_BYTES)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(e)
    bytes += size
  }
  if (cur.length) out.push(cur)
  return out
}

function stripLineNumbers(s) {
  return s.replace(/^ *\d+\t/gm, '')
}

function safeJson(v) {
  try {
    const s = JSON.stringify(v)
    return s === '{}' ? '' : s
  } catch {
    return ''
  }
}
