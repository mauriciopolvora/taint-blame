#!/usr/bin/env node
// Replay a saved agent session into Taint Blame.
//
//   node adapters/import.mjs <session.jsonl> [--agent claude-code|pi] [--session-id ID] [--dry-run]
//   node adapters/import.mjs --flush        # only retry ~/.taint-blame/queue.jsonl
//
// Formats (auto-detected, or forced with --agent):
//   claude-code  ~/.claude/projects/<project>/<uuid>.jsonl
//   pi           ~/.pi/agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl
// Config: TAINT_BLAME_URL / TAINT_BLAME_TOKEN from env, else ~/.taint-blame/config.env.
// Note: the server does not dedupe, so importing the same session twice stores it twice.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { clean, fileTrust, flushQueue, redact, send } from './shared/client.mjs'
import { batches, promptEvent, repoRoot, toolEvents, toText } from './claude-code/map.mjs'

function loadConfig() {
  if (process.env.TAINT_BLAME_URL && process.env.TAINT_BLAME_TOKEN) return
  try {
    for (const line of readFileSync(join(homedir(), '.taint-blame', 'config.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(TAINT_BLAME_[A-Z_]+)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch {}
}

function parseArgs(argv) {
  const o = { file: undefined, agent: undefined, sessionId: undefined, dryRun: false, flush: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--agent') o.agent = argv[++i]
    else if (a === '--session-id') o.sessionId = argv[++i]
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--flush') o.flush = true
    else if (a === '-h' || a === '--help') o.help = true
    else if (!o.file) o.file = a
  }
  return o
}

const tsOf = (v, fallback) => {
  const n = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(n) ? n : fallback
}

function detect(entries) {
  if (entries.some((e) => e.type === 'session' && 'version' in e) || entries.some((e) => e.type === 'message' && e.message?.role === 'toolResult')) return 'pi'
  if (entries.some((e) => (e.type === 'user' || e.type === 'assistant') && e.message && 'sessionId' in e)) return 'claude-code'
  return undefined
}

// ---------- Claude Code ----------

const SKIP_PROMPT = /^\s*<(command-name|command-message|local-command-stdout|local-command-caveat|task-notification|system-reminder)>/

function claudeCode(entries, file) {
  const events = []
  const uses = new Map() // tool_use id -> { name, input }
  let sessionId = basename(file, '.jsonl')
  let lastTs = 0

  for (const e of entries) {
    if (e.sessionId && !e.isSidechain) sessionId = e.sessionId
    if (e.type !== 'user' && e.type !== 'assistant') continue
    const ts = tsOf(e.timestamp, lastTs)
    lastTs = ts
    const ctx = { session_id: e.sessionId || sessionId, cwd: e.cwd, ts }
    const content = e.message?.content

    if (e.type === 'assistant') {
      if (Array.isArray(content)) for (const b of content) if (b?.type === 'tool_use') uses.set(b.id, { name: b.name, input: b.input })
      continue
    }

    // user entry: either a prompt or tool results
    if (typeof content === 'string') {
      if (!e.isMeta && !e.isSidechain && !SKIP_PROMPT.test(content)) events.push(...promptEvent(ctx, content))
      continue
    }
    if (!Array.isArray(content)) continue
    const results = content.filter((b) => b?.type === 'tool_result')
    if (!results.length) {
      const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
      if (!e.isMeta && !e.isSidechain && !SKIP_PROMPT.test(text)) events.push(...promptEvent(ctx, text))
      continue
    }
    for (const r of results) {
      const use = uses.get(r.tool_use_id)
      if (!use) continue
      // toolUseResult mirrors the hook's tool_response, but only when unambiguous.
      const structured = results.length === 1 && e.toolUseResult && typeof e.toolUseResult === 'object' ? e.toolUseResult : undefined
      const isWrite = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(use.name)
      if (r.is_error && isWrite) continue // the write did not happen
      events.push(...toolEvents(ctx, use.name, use.input, structured, r.content))
    }
  }
  return events
}

// ---------- pi ----------
// Entries: {type:"session", id, cwd}, then {type:"message", id, parentId, timestamp, message}
// with message.role user | assistant (content[] has {type:"toolCall", id, name, arguments}) | toolResult.

function piTrustForPath(path, cwd) {
  return fileTrust(path || '.', repoRoot(cwd) || cwd)
}

function pi(entries, file) {
  const events = []
  const calls = new Map()
  const header = entries.find((e) => e.type === 'session') ?? {}
  const sessionId = header.id || basename(file, '.jsonl')
  const cwd = header.cwd
  const base = { agent: 'pi', session_id: sessionId, ...(cwd && cwd.length <= 1024 ? { cwd } : {}) }
  const ref = (s) => {
    if (s === undefined || s === null || s === '') return {}
    const r = redact(String(s))
    return { source_ref: r.length > 2048 ? r.slice(0, 2047) + '…' : r }
  }
  const input = (ts, source, trust, content, sref, path) => ({ ...base, ts, kind: 'input', source, trust, content: clean(content, path), ...ref(sref) })
  const write = (ts, source, file_path, old_text, new_text) => ({
    ...base, ts, kind: 'write', source, file_path: String(file_path), old_text: clean(old_text ?? '', file_path), new_text: clean(new_text ?? '', file_path),
  })
  const abs = (p) => (p && !isAbsolute(p) && cwd ? resolve(cwd, p) : p)

  let lastTs = 0
  for (const e of entries) {
    if (e.type !== 'message' || !e.message) continue
    const m = e.message
    const ts = tsOf(e.timestamp, tsOf(m.timestamp, lastTs))
    lastTs = ts
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : toText((m.content ?? []).filter((b) => b?.type === 'text'))
      if (text.trim()) events.push(input(ts, 'user_prompt', 'trusted', text))
    } else if (m.role === 'assistant') {
      for (const b of m.content ?? []) if (b?.type === 'toolCall') calls.set(b.id, { name: b.name, args: b.arguments ?? {} })
    } else if (m.role === 'toolResult') {
      const call = calls.get(m.toolCallId) ?? { name: m.toolName, args: {} }
      const a = call.args ?? {}
      const name = call.name ?? m.toolName
      const out = toText((m.content ?? []).filter((b) => b?.type === 'text'))
      switch (name) {
        case 'read': events.push(input(ts, 'read', piTrustForPath(abs(a.path), cwd), out, abs(a.path), a.path)); break
        case 'bash': events.push(input(ts, 'bash', 'untrusted', out, a.command)); break
        case 'grep': events.push(input(ts, 'grep', piTrustForPath(abs(a.path), cwd), out, [a.pattern, a.path].filter(Boolean).join(' in '))); break
        case 'find':
        case 'ls': events.push(input(ts, 'glob', piTrustForPath(abs(a.path), cwd), out, [a.pattern, a.path].filter(Boolean).join(' in ') || name)); break
        case 'write': if (!m.isError && a.path) events.push(write(ts, 'write', abs(a.path), '', a.content)); break
        case 'edit': {
          if (m.isError || !a.path) break
          const edits = [...(Array.isArray(a.edits) ? a.edits : [])]
          if (typeof a.oldText === 'string' && typeof a.newText === 'string') edits.push({ oldText: a.oldText, newText: a.newText })
          edits.forEach((ed, i) => events.push(write(ts + i, 'edit', abs(a.path), ed?.oldText, ed?.newText)))
          break
        }
        default:
          // Extension / custom tools: unknown provenance, treat their output as untrusted.
          if (name) events.push(input(ts, name.startsWith('mcp') ? `mcp:${name.replace(/^mcp_*/, '')}` : name, 'untrusted', out, JSON.stringify(a)))
      }
    }
  }
  return events
}

// ---------- main ----------

function readJsonl(file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || (!o.file && !o.flush)) {
    console.error('usage: node adapters/import.mjs <session.jsonl> [--agent claude-code|pi] [--session-id ID] [--dry-run]\n       node adapters/import.mjs --flush')
    process.exit(o.help ? 0 : 2)
  }
  loadConfig()
  if (!o.dryRun && !(process.env.TAINT_BLAME_URL && process.env.TAINT_BLAME_TOKEN))
    console.error('warning: TAINT_BLAME_URL/TOKEN not set (env or ~/.taint-blame/config.env); events will be queued')

  if (o.file) {
    const entries = readJsonl(o.file)
    const agent = o.agent ?? detect(entries)
    if (agent !== 'claude-code' && agent !== 'pi') {
      console.error(`cannot detect session format of ${o.file}; pass --agent claude-code|pi`)
      process.exit(2)
    }
    // Claude Code keeps subagent transcripts next to the session: <uuid>/subagents/agent-*.jsonl.
    // The live hook sees their tool calls too, so include them (their prompts are skipped as sidechain).
    if (agent === 'claude-code') {
      const sub = join(dirname(o.file), basename(o.file, '.jsonl'), 'subagents')
      if (existsSync(sub)) for (const f of readdirSync(sub).filter((n) => n.endsWith('.jsonl'))) entries.push(...readJsonl(join(sub, f)))
    }
    let events = agent === 'pi' ? pi(entries, o.file) : claudeCode(entries, o.file)
    if (o.sessionId) events = events.map((e) => ({ ...e, session_id: o.sessionId }))
    events.sort((a, b) => a.ts - b.ts)

    const counts = {}
    for (const e of events) counts[`${e.kind}:${e.source}`] = (counts[`${e.kind}:${e.source}`] ?? 0) + 1
    const sessions = [...new Set(events.map((e) => e.session_id))]

    if (o.dryRun) {
      for (const e of events) console.log(JSON.stringify(e))
      console.error('[dry-run] %s: %d events, sessions %s', agent, events.length, sessions.join(', '), counts)
      return
    }
    const bs = batches(events)
    // send() never throws; failed batches land in the queue and are retried by flushQueue below.
    for (const b of bs) await send(b)
    console.error('%s: submitted %d events (failures queued) in %d batch(es), sessions %s', agent, events.length, bs.length, sessions.join(', '), counts)
  }
  if (!o.dryRun) {
    const flushed = await flushQueue()
    console.error(`queue: flushed ${flushed} event(s)`)
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
