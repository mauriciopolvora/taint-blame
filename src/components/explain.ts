import type { Attribution, ContextEvent, Verdict, WriteEvent } from '#/server/queries'

// Turns raw rows into plain-English labels and explanations. No LLM: every
// sentence here is assembled from the data.

export type VerdictOrPending = Verdict | 'pending'

export function v(verdict: string | null | undefined): VerdictOrPending {
  return verdict === 'red' || verdict === 'amber' || verdict === 'green' ? verdict : 'pending'
}

export const VERDICT_LABEL: Record<VerdictOrPending, string> = {
  red: 'Injected',
  amber: 'Borrowed',
  green: 'Your request',
  pending: 'Checking',
}

export const VERDICT_HINT: Record<VerdictOrPending, string> = {
  red: 'Did something you never asked for, following an instruction hidden in outside content',
  amber: 'Copied or adapted from outside content, but serves what you asked for',
  green: 'Explained by your request and your repo alone',
  pending: 'Still being checked',
}

// ---------- Inputs ----------

export type InputKind = 'prompt' | 'file' | 'search-files' | 'command' | 'web' | 'web-search' | 'github' | 'tool' | 'agent'

export type InputInfo = {
  kind: InputKind
  label: string // "GitHub issue"
  noun: string // "a GitHub issue", used mid-sentence
  detail: string // "acme/acme-http#482", path, command…
  short?: string // compact detail for use inside sentences
  outside: boolean // came from outside the user and their repo
}

const GH_WEB_ISSUE = /github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/
const GH_API_ISSUE = /api\.github\.com\/repos\/([^/\s]+)\/([^/\s]+)\/(issues|pulls)\/(\d+)/
const GH_CLI = /^\s*gh\s+(issue|pr)\s+(view|list|comment)\b/

export function describeInput(c: ContextEvent | undefined, cwd?: string | null): InputInfo {
  if (!c) return { kind: 'tool', label: 'Unknown input', noun: 'an unknown input', detail: '', outside: true }
  const ref = c.source_ref ?? ''
  const outside = c.trust === 'untrusted'
  const src = c.source

  const gh = ref.match(GH_WEB_ISSUE) ?? ref.match(GH_API_ISSUE)
  if (gh && (src === 'web_fetch' || src === 'bash' || src.startsWith('mcp'))) {
    const pr = gh[3].startsWith('pull')
    return {
      kind: 'github',
      label: pr ? 'GitHub pull request' : 'GitHub issue',
      noun: pr ? 'a GitHub pull request' : 'a GitHub issue',
      detail: `${gh[1]}/${gh[2]}#${gh[4]}`,
      outside,
    }
  }
  if (src === 'bash' && (GH_CLI.test(ref) || /\bcurl\b.*api\.github\.com\/.*\/issues/.test(ref))) {
    const pr = /^\s*gh\s+pr/.test(ref)
    return {
      kind: 'github',
      label: pr ? 'GitHub pull request' : 'GitHub issue',
      noun: pr ? 'a GitHub pull request' : 'a GitHub issue',
      detail: ref.trim(),
      outside,
    }
  }
  if (src.startsWith('mcp') && /issue|pull_request|get_pr/i.test(src)) {
    return { kind: 'github', label: 'GitHub issue', noun: 'a GitHub issue', detail: ref || src.slice(4), outside }
  }

  switch (src) {
    case 'user_prompt':
    case 'prompt':
      return { kind: 'prompt', label: 'You asked', noun: 'your request', detail: '', outside: false }
    case 'read':
    case 'file_read':
      return { kind: 'file', label: 'Read file', noun: 'a file', detail: relPath(ref, cwd), outside }
    case 'grep':
    case 'glob':
    case 'find':
    case 'ls':
      return { kind: 'search-files', label: 'Searched files', noun: 'a file search', detail: ref, outside }
    case 'bash':
      return { kind: 'command', label: 'Ran command', noun: 'command output', detail: ref, outside }
    case 'web_fetch':
      return { kind: 'web', label: 'Fetched web page', noun: 'a web page', detail: prettyUrl(ref), short: host(ref), outside }
    case 'web_search':
      return { kind: 'web-search', label: 'Searched the web', noun: 'web search results', detail: ref, outside }
    case 'task':
      return { kind: 'agent', label: 'Sub-agent report', noun: 'a sub-agent report', detail: ref, outside }
  }
  if (src.startsWith('mcp')) {
    const name = src.replace(/^mcp[:_]+/, '').replace(/__/g, ' · ')
    return { kind: 'tool', label: `Tool: ${name}`, noun: `the ${name} tool`, detail: ref, outside }
  }
  return { kind: 'tool', label: `Tool: ${src}`, noun: `the ${src} tool`, detail: ref, outside }
}

function prettyUrl(u: string): string {
  try {
    const url = new URL(u)
    return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return u
  }
}

function host(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function relPath(p: string, cwd?: string | null): string {
  if (!cwd || !p.startsWith(cwd)) return p
  return p.slice(cwd.length).replace(/^\/+/, '') || p
}

export function basename(p: string): string {
  return p.split('/').pop() || p
}

// ---------- Attribution ----------

// Overlap rows store `reason | "fragment"`.
export function splitOverlapReason(reason: string | null): { text: string; fragment: string | null } {
  if (!reason) return { text: '', fragment: null }
  const m = reason.match(/^(.*) \| "(.*)"$/s)
  return m ? { text: m[1], fragment: m[2] } : { text: reason, fragment: null }
}

// Quoted pieces inside a reason: "..." “...” `...`
function quoted(reason: string): string[] {
  const out: string[] = []
  for (const m of reason.matchAll(/"([^"]{6,})"|“([^”]{6,})”|`([^`]{6,})`/g)) out.push((m[1] ?? m[2] ?? m[3]).trim())
  return out
}

export type Explanation = {
  verdict: VerdictOrPending
  cause: ContextEvent | null // the input most responsible for the verdict
  why: string | null // best human explanation (judge reason preferred)
  matched: string[] // text fragments shared between the edit and the cause
  fragments: string[] // everything worth highlighting in the cause
}

const METHOD_RANK = { llm: 1, overlap: 0 } as const

export function explain(w: WriteEvent, ctx: Map<string, ContextEvent>): Explanation {
  const verdict = v(w.verdict)
  const same = w.attributions.filter((a) => a.verdict === w.verdict)
  const pool = same.length ? same : w.attributions
  const best = [...pool].sort(
    (a, b) => METHOD_RANK[b.method] - METHOD_RANK[a.method] || b.confidence - a.confidence,
  )[0] as Attribution | undefined

  const cause = best ? (ctx.get(best.context_id) ?? null) : null
  const forCause = best ? w.attributions.filter((a) => a.context_id === best.context_id) : []
  const llm = forCause.find((a) => a.method === 'llm' && a.reason) ?? same.find((a) => a.method === 'llm' && a.reason)
  const overlaps = forCause.filter((a) => a.method === 'overlap')

  const matched: string[] = []
  const fragments: string[] = []
  for (const a of overlaps) {
    const { text, fragment } = splitOverlapReason(a.reason)
    if (fragment) matched.push(fragment)
    fragments.push(...(fragment ? [fragment] : []), ...quoted(text))
  }
  if (llm?.reason) fragments.push(...quoted(llm.reason))

  let why: string | null = llm?.reason ?? null
  if (!why && overlaps[0]) {
    // Seeded / older overlap rows carry readable prose; generated ones are terse.
    const { text } = splitOverlapReason(overlaps[0].reason)
    why = /^(shares|uses domain|introduces identifiers)/.test(text) ? null : text
  }

  return { verdict, cause, why, matched: dedupe(matched), fragments: dedupe(fragments) }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))]
}

export function headlineFor(verdict: VerdictOrPending, cause: InputInfo | null): string {
  const d = cause?.short ?? cause?.detail
  const from = cause ? `${cause.noun}${d ? ` (${d})` : ''}` : 'outside content'
  switch (verdict) {
    case 'red':
      return `Did something you never asked for, following an instruction in ${from}.`
    case 'amber':
      return `Borrowed code from ${from}. It serves what you asked for.`
    case 'green':
      return 'Matches what you asked for.'
    default:
      return 'Still being checked.'
  }
}

// ---------- Highlighting inside an input ----------

export type Range = [number, number]

export function findRanges(content: string, frags: string[]): Range[] {
  const lower = content.toLowerCase()
  const ranges: Range[] = []
  for (const f of frags) {
    for (const needle of [f, f.replace(/`/g, '')]) {
      if (needle.length < 4) continue
      const idx = lower.indexOf(needle.toLowerCase())
      if (idx >= 0) {
        ranges.push([idx, idx + needle.length])
        break
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

export type Excerpt = {
  text: string
  ranges: Range[] // relative to text
  hidden: boolean // inside an HTML comment, i.e. invisible on the rendered page
  clippedStart: boolean
  clippedEnd: boolean
}

const MAX_SIDE = 220

// The sentence (or hidden comment) around the first highlighted fragment.
export function excerpt(content: string, frags: string[]): Excerpt | null {
  const all = findRanges(content, frags)
  if (all.length === 0) return null
  const [s0, e0] = all[0]

  let start: number
  let end: number
  let hidden = false
  const open = content.lastIndexOf('<!--', s0)
  const close = open >= 0 ? content.indexOf('-->', open) : -1
  if (open >= 0 && close >= e0) {
    hidden = true
    start = open + 4
    end = close
  } else {
    start = sentenceStart(content, s0)
    end = sentenceEnd(content, e0)
  }
  // A hidden comment is the whole payload, so show more of it.
  const side = hidden ? MAX_SIDE * 3 : MAX_SIDE
  const clippedStart = s0 - start > side
  const clippedEnd = end - e0 > side
  if (clippedStart) start = wordBoundary(content, s0 - side, 1)
  if (clippedEnd) end = wordBoundary(content, e0 + side, -1)

  // Trim whitespace, keeping ranges aligned.
  while (start < s0 && /\s/.test(content[start])) start++
  while (end > e0 && /\s/.test(content[end - 1])) end--

  const ranges = all
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]) => [s - start, e - start] as Range)
  return { text: content.slice(start, end), ranges, hidden, clippedStart, clippedEnd }
}

function wordBoundary(t: string, i: number, dir: 1 | -1): number {
  let k = i
  for (let n = 0; n < 30 && k > 0 && k < t.length && !/\s/.test(t[k]); n++) k += dir
  return k
}

function sentenceStart(t: string, i: number): number {
  for (let k = i - 1; k > 0; k--) {
    if (t[k] === '\n' && t[k - 1] === '\n') return k + 1
    if (/[.!?]/.test(t[k - 1]) && /\s/.test(t[k])) return k
  }
  return 0
}

function sentenceEnd(t: string, i: number): number {
  for (let k = i; k < t.length; k++) {
    if (t[k] === '\n' && t[k + 1] === '\n') return k
    if (/[.!?]/.test(t[k]) && (k + 1 >= t.length || /\s/.test(t[k + 1]))) return k + 1
  }
  return t.length
}

// ---------- Session summary ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function sessionSummary(writes: WriteEvent[], ctx: Map<string, ContextEvent>, cwd: string | null): string[] {
  if (writes.length === 0) return ['The agent has not edited any files yet.']
  const files = new Set(writes.map((w) => w.file_path)).size
  const by = { red: [] as WriteEvent[], amber: [] as WriteEvent[], green: [] as WriteEvent[], pending: [] as WriteEvent[] }
  for (const w of writes) by[v(w.verdict)].push(w)

  const out = [`The agent made ${plural(writes.length, 'edit')} in ${plural(files, 'file')}.`]

  const sources = (ws: WriteEvent[]) => {
    const seen = new Map<string, string>()
    for (const w of ws) {
      const info = describeInput(explain(w, ctx).cause ?? undefined, cwd)
      const d = info.short ?? info.detail
      const key = `${info.noun}${d}`
      if (!seen.has(key)) seen.set(key, d ? `${info.noun} (${d})` : info.noun)
    }
    return joinList([...seen.values()])
  }
  const inFiles = (ws: WriteEvent[]) => joinList([...new Set(ws.map((w) => basename(w.file_path)))])

  if (by.red.length) {
    const n = by.red.length
    out.push(
      `${n === 1 ? '1 edit' : `${n} edits`} did something you never asked for: ${n === 1 ? 'it' : 'they'} changed ${inFiles(by.red)} following an instruction in ${sources(by.red)}.`,
    )
  }
  if (by.amber.length) {
    const n = by.amber.length
    out.push(`${n === 1 ? '1 edit' : `${n} edits`} borrowed code from ${sources(by.amber)}; that looks harmless.`)
  }
  if (by.green.length) {
    const n = by.green.length
    const rest = by.red.length || by.amber.length
    out.push(
      rest
        ? `The other ${n === 1 ? 'edit matches' : `${n} match`} what you asked for.`
        : `${n === 1 ? 'It matches' : 'All of them match'} what you asked for.`,
    )
  }
  if (by.pending.length) out.push(`${plural(by.pending.length, 'edit is', 'edits are')} still being checked.`)
  return out
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}
