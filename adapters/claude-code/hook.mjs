#!/usr/bin/env node
// Taint Blame hook for Claude Code (UserPromptSubmit + PostToolUse + PreToolUse).
// Zero dependencies. Never writes to stdout (UserPromptSubmit stdout is injected
// into the model's context), always exits 0, and gives up after ~2.5 s.
// The one exception: in guard mode (TAINT_BLAME_GUARD or guard= in config.env),
// PreToolUse for Edit/Write/MultiEdit prints Claude Code's permission decision
// JSON ("ask", or "deny" with guard=block) when the edit copies code from an
// untrusted input of this session. Local only (no network), ~2 s cap, fails open.
//
// Config: TAINT_BLAME_URL and TAINT_BLAME_TOKEN from the environment, or else
// from ~/.taint-blame/config.env (KEY=value lines). If the POST fails or times
// out, events go to ~/.taint-blame/queue.jsonl (flush with `node adapters/import.mjs --flush`).

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HARD_CAP_MS = 2500
setTimeout(() => process.exit(0), HARD_CAP_MS).unref()
process.on('uncaughtException', () => process.exit(0))
process.on('unhandledRejection', () => process.exit(0))

function loadConfig() {
  if (process.env.TAINT_BLAME_URL && process.env.TAINT_BLAME_TOKEN) return
  try {
    const text = readFileSync(join(homedir(), '.taint-blame', 'config.env'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?(TAINT_BLAME_[A-Z_]+)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch {}
}

function readStdin() {
  return new Promise((res) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => res(data))
    process.stdin.on('error', () => res(data))
  })
}

async function main() {
  const raw = await readStdin()
  let h
  try { h = JSON.parse(raw) } catch { return }
  if (!h || !h.session_id) return

  if (h.hook_event_name === 'PreToolUse') {
    setTimeout(() => process.exit(0), 2000).unref()
    const { preToolUse } = await import('./guard.mjs')
    const decision = await preToolUse(h)
    if (decision) process.stdout.write(JSON.stringify(decision) + '\n', () => process.exit(0))
    return
  }

  const { promptEvent, toolEvents, batches } = await import('./map.mjs')
  const ctx = { session_id: h.session_id, cwd: h.cwd, ts: Date.now() }
  let events = []
  if (h.hook_event_name === 'UserPromptSubmit') events = promptEvent(ctx, h.prompt)
  else if (h.hook_event_name === 'PostToolUse' && typeof h.tool_name === 'string')
    events = toolEvents(ctx, h.tool_name, h.tool_input, h.tool_response)
  if (!events.length) return

  // Keep this session's inputs locally so the PreToolUse guard can check edits.
  try {
    const { storeInputs } = await import('./guard.mjs')
    storeInputs(h.session_id, events)
  } catch {}

  loadConfig()
  const { send } = await import('../shared/client.mjs')
  for (const b of batches(events)) await send(b)
}

main().catch(() => {}).finally(() => {
  // Let a pending stdout write (PreToolUse decision) flush before exiting.
  if (!process.stdout.writableLength) process.exit(0)
})
