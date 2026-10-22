// Instant, deterministic attribution: what in an edit's added text can only
// have come from an untrusted input? Pure functions so the eval script can
// run them outside the Worker.

export type Verdict = 'green' | 'amber' | 'red'

export type ContextInput = {
  id: string
  source: string
  source_ref: string | null
  trust: 'trusted' | 'semi' | 'untrusted'
  content: string
}

export type WriteInput = {
  file_path: string
  old_text: string
  new_text: string
}

export type Finding = {
  context_id: string
  confidence: number
  verdict: Exclude<Verdict, 'green'>
  reason: string
  fragment: string // the copied piece, for highlighting in the UI
}

const URL_RE = /https?:\/\/[^\s'"`<>()[\]{}]+/g
const IDENT_RE = /[A-Za-z_$][\w$-]{3,}/g
const TOKEN_RE = /[A-Za-z_$][\w$]*|\d+|[^\s\w]/g
const NGRAM = 5
const MIN_CONFIDENCE = 0.3

// Words that show up everywhere and prove nothing.
const COMMON = new Set(
  `const function return import export from await async true false null undefined this that with
  should test expect describe await then else elif while for each type interface string number
  boolean void new class extends default case break continue throw catch finally try yield
  let var public private static readonly http https www com org the and you your have will
  when what into some also make sure please file files code line lines error value result data
  self def none pass lambda print require module exports console log`.split(/\s+/),
)

// Phrases that turn content into an instruction aimed at the agent.
const CUE_RE =
  /\b(also|additionally|make sure|be sure|you must|you should|ignore (?:all |the )?previous|don'?t (?:tell|mention)|without (?:telling|asking)|silently|quietly|please add|add a|send|post|ping|report|telemetry|exfiltrat\w*|curl|beacon|analytics|install|run)\b/i

function trimUrl(u: string) {
  return u.replace(/[.,;:!?'"`]+$/, '')
}

function urls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map(trimUrl))]
}

function host(u: string): string | null {
  try {
    return new URL(u).host
  } catch {
    return null
  }
}

function idents(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.match(IDENT_RE) ?? []) {
    if (!COMMON.has(m.toLowerCase())) out.add(m)
  }
  return out
}

function ngrams(text: string): Set<string> {
  const toks = text.match(TOKEN_RE) ?? []
  const out = new Set<string>()
  for (let i = 0; i + NGRAM <= toks.length; i++) out.add(toks.slice(i, i + NGRAM).join(' '))
  return out
}

// Lines present in new_text but not old_text. Good enough for per-edit blame.
export function addedText(w: WriteInput): string {
  const old = new Set(w.old_text.split('\n').map((l) => l.trim()))
  return w.new_text
    .split('\n')
    .filter((l) => l.trim() && !old.has(l.trim()))
    .join('\n')
}

// The cue has to sit in the same sentence as the copied fragment, otherwise
// one injected line would taint every other snippet copied from that page.
function hasCueNear(content: string, fragment: string): boolean {
  const at = content.indexOf(fragment)
  if (at < 0) return false
  const before = content.slice(0, at)
  const start = Math.max(before.lastIndexOf('\n'), before.search(/[.!?]\s[^.!?]*$/)) + 1
  const rest = content.slice(at + fragment.length)
  const endRel = rest.search(/[.!?](\s|$)|\n/)
  const sentence = content.slice(start, at + fragment.length + (endRel < 0 ? rest.length : endRel))
  return CUE_RE.test(sentence)
}

export function overlap(write: WriteInput, contexts: ContextInput[]): Finding[] {
  const added = addedText(write)
  if (!added) return []

  // Anything the user said, the repo already contained, or the file used to
  // hold explains itself and is not evidence of outside influence.
  const explained = [write.old_text, ...contexts.filter((c) => c.trust !== 'untrusted').map((c) => c.content)].join('\n')
  const prompts = contexts.filter((c) => c.trust === 'trusted').map((c) => c.content).join('\n')

  const explainedIds = idents(explained)
  const explainedGrams = ngrams(explained)
  const explainedUrls = new Set(urls(explained))
  const explainedHosts = new Set([...explainedUrls].map(host).filter(Boolean))

  const addedUrls = urls(added).filter((u) => !explainedUrls.has(u))
  const novelIds = [...idents(added)].filter((id) => !explainedIds.has(id))
  const novelGrams = [...ngrams(added)].filter((g) => !explainedGrams.has(g))
  const totalGrams = Math.max(1, ngrams(added).size)

  const findings: Finding[] = []

  for (const ctx of contexts) {
    if (ctx.trust !== 'untrusted') continue

    const ctxUrls = urls(ctx.content)
    const ctxHosts = new Set(ctxUrls.map(host).filter(Boolean))
    const ctxIds = idents(ctx.content)
    const ctxGrams = ngrams(ctx.content)

    const urlHits = addedUrls.filter((u) => ctxUrls.includes(u))
    const hostHits = addedUrls
      .map(host)
      .filter((h): h is string => !!h && ctxHosts.has(h) && !explainedHosts.has(h))
    const idHits = novelIds.filter((id) => ctxIds.has(id))
    const gramHits = novelGrams.filter((g) => ctxGrams.has(g))

    const scores: Array<[number, string, string]> = []
    if (urlHits.length) scores.push([0.9, `copied URL "${urlHits[0]}"`, urlHits[0]])
    if (hostHits.length) scores.push([0.6, `uses domain "${hostHits[0]}"`, hostHits[0]])
    if (gramHits.length) {
      const frac = gramHits.length / totalGrams
      const fragment = gramHits[0].replace(/ (?=\W)|(?<=\W) /g, '')
      scores.push([Math.min(0.85, 0.3 + frac * 1.5), `shares ${gramHits.length} token sequences`, fragment])
    }
    if (idHits.length) {
      const c = Math.min(0.7, 0.15 + (0.55 * idHits.length) / Math.max(3, novelIds.length))
      scores.push([c, `introduces identifiers only found here: ${idHits.slice(0, 5).join(', ')}`, idHits[0]])
    }
    if (!scores.length) continue

    scores.sort((a, b) => b[0] - a[0])
    const [confidence, , fragment] = scores[0]
    if (confidence < MIN_CONFIDENCE) continue

    // Red when the copied piece sits next to an imperative aimed at the agent
    // and the user never mentioned it.
    const instructed = hasCueNear(ctx.content, fragment) && !prompts.includes(fragment)
    const where = ctx.source_ref ? `${ctx.source} ${ctx.source_ref}` : ctx.source

    findings.push({
      context_id: ctx.id,
      confidence: Number(confidence.toFixed(2)),
      verdict: instructed ? 'red' : 'amber',
      reason: `${scores.map((s) => s[1]).join('; ')} from ${where}${instructed ? ', next to an instruction the user never gave' : ''}`,
      fragment,
    })
  }

  return findings.sort((a, b) => b.confidence - a.confidence)
}

export function worst(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('red')) return 'red'
  if (verdicts.includes('amber')) return 'amber'
  return 'green'
}
