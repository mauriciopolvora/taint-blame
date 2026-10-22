#!/usr/bin/env node
// Adds the Taint Blame hooks to <target>/.claude/settings.json (default: cwd),
// merging with existing settings. Idempotent.
// Usage: node adapters/claude-code/install.mjs [target-repo] [--local]
//   --local  write .claude/settings.local.json instead (not committed)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const target = resolve(args.find((a) => !a.startsWith('--')) ?? '.')
const file = join(target, '.claude', args.includes('--local') ? 'settings.local.json' : 'settings.json')
const hookPath = join(dirname(fileURLToPath(import.meta.url)), 'hook.mjs')
const command = `node ${JSON.stringify(hookPath)}`
const entry = { type: 'command', command, timeout: 5 }

let settings = {}
if (existsSync(file)) {
  try { settings = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    console.error(`Cannot parse ${file}: ${e.message}`); process.exit(1)
  }
}
settings.hooks ??= {}

function add(event, matcher) {
  const groups = (settings.hooks[event] ??= [])
  // Drop any earlier Taint Blame hook (e.g. from another checkout path).
  for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => !/adapters\/claude-code\/hook\.mjs/.test(h.command ?? ''))
  settings.hooks[event] = groups.filter((g) => g.hooks.length)
  settings.hooks[event].push(matcher ? { matcher, hooks: [entry] } : { hooks: [entry] })
}
add('UserPromptSubmit')
add('PostToolUse', '*')

mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
console.log(`Taint Blame hooks written to ${file}\n  -> ${command}`)
if (!process.env.TAINT_BLAME_URL && !existsSync(join(process.env.HOME ?? '', '.taint-blame', 'config.env')))
  console.log('Note: set TAINT_BLAME_URL/TAINT_BLAME_TOKEN or create ~/.taint-blame/config.env (chmod 600).')
