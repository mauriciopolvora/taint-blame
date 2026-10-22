// Shared client for every Taint Blame adapter. Zero dependencies, Node >= 18.
// Contract: never throws, never blocks the agent for more than ~2 s.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MAX_CONTENT = 20 * 1024
const TIMEOUT_MS = 2000
// Lives in the repo's own .taint-blame/ (gitignored), next to config.env.
const QUEUE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.taint-blame')
const QUEUE_FILE = join(QUEUE_DIR, 'queue.jsonl')

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
]

// KEY=value lines from .env-style content, and "secret": "..." JSON-ish pairs.
const ASSIGNMENT = /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*\s*[=:]\s*).+$/gim
const ENV_LINE = /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}=)(\S.*)$/gm

export function redact(text, { envFile = false } = {}) {
  if (typeof text !== 'string' || !text) return text ?? ''
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]')
  out = out.replace(ASSIGNMENT, '$1[REDACTED]')
  if (envFile) out = out.replace(ENV_LINE, '$1[REDACTED]')
  return out
}

export function cap(text) {
  if (typeof text !== 'string') return ''
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT)}\n[truncated]` : text
}

export function isEnvFile(path) {
  return typeof path === 'string' && /(^|\/)\.env(\.|$)|\.dev\.vars|\.npmrc$|\.netrc$/.test(path)
}

export function clean(text, path) {
  return cap(redact(text, { envFile: isEnvFile(path) }))
}

// Trust lookup from the handoff table. cwd is the repo root.
export function fileTrust(filePath, cwd) {
  if (!filePath || !cwd) return 'untrusted'
  const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  const rel = relative(cwd, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return 'untrusted'
  if (/^\.claude\/skills(\/|$)/.test(rel) || /^\.pi(\/|$)/.test(rel)) return 'untrusted'
  return 'semi'
}

function config() {
  return {
    url: process.env.TAINT_BLAME_URL?.replace(/\/$/, ''),
    token: process.env.TAINT_BLAME_TOKEN,
  }
}

function enqueue(events) {
  try {
    mkdirSync(QUEUE_DIR, { recursive: true, mode: 0o700 })
    appendFileSync(QUEUE_FILE, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 })
  } catch {}
}

async function post(events) {
  const { url, token } = config()
  if (!url || !token) return false
  try {
    const res = await fetch(`${url}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

// Send one or more events. Falls back to the local queue on any failure.
export async function send(eventOrEvents) {
  try {
    const events = (Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]).filter(Boolean)
    if (events.length === 0) return
    if (!(await post(events))) enqueue(events)
  } catch {}
}

// Retry queued events. Used by the importer and optionally at session start.
export async function flushQueue() {
  try {
    if (!existsSync(QUEUE_FILE)) return 0
    const sending = `${QUEUE_FILE}.${process.pid}.sending`
    renameSync(QUEUE_FILE, sending)
    const events = readFileSync(sending, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    let sent = 0
    for (let i = 0; i < events.length; i += 100) {
      const batch = events.slice(i, i + 100)
      if (await post(batch)) sent += batch.length
      else enqueue(batch)
    }
    unlinkSync(sending)
    return sent
  } catch {
    return 0
  }
}
