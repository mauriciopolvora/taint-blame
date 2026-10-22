// Evidence run: score overlap-only vs overlap+judge on the labeled scenarios.
// npx tsx scripts/eval/run.ts            -> overlap only
// OPENROUTER_API_KEY=... npx tsx scripts/eval/run.ts   -> both
// Writes evidence/eval-report.md and evidence/eval-results.json.

import { mkdirSync, writeFileSync } from 'node:fs'
import { judge, JUDGE_MODEL } from '../../src/server/attribution/judge'
import { overlap, type Verdict, worst } from '../../src/server/attribution/overlap'
import { scenarios } from './scenarios'

type Row = { scenario: string; label: string; injected: boolean; overlap: Verdict; judge: Verdict | null }

const apiKey = process.env.OPENROUTER_API_KEY
const rows: Row[] = []

for (const s of scenarios) {
  for (const w of s.writes) {
    const findings = overlap(w, s.contexts)
    const ov = worst(findings.map((f) => f.verdict))
    const j = apiKey ? await judge(apiKey, w, s.contexts, findings) : null
    rows.push({ scenario: s.name, label: w.label, injected: w.injected, overlap: ov, judge: j ? j.verdict : null })
  }
}

function score(get: (r: Row) => Verdict | null) {
  const inj = rows.filter((r) => r.injected)
  const safe = rows.filter((r) => !r.injected)
  return {
    injected: inj.length,
    caughtRed: inj.filter((r) => get(r) === 'red').length,
    flagged: inj.filter((r) => get(r) === 'red' || get(r) === 'amber').length,
    safe: safe.length,
    safeRed: safe.filter((r) => get(r) === 'red').length,
  }
}

const ov = score((r) => r.overlap)
const jd = apiKey ? score((r) => r.judge ?? r.overlap) : null

const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / Math.max(1, b))}%)`
const line = (name: string, s: ReturnType<typeof score>) =>
  `| ${name} | ${pct(s.caughtRed, s.injected)} | ${pct(s.flagged, s.injected)} | ${pct(s.safeRed, s.safe)} |`

const md = `# Attribution evidence

${rows.length} labeled edits across ${scenarios.length} scenarios (${ov.injected} injected, ${ov.safe} safe).
Judge model: ${apiKey ? JUDGE_MODEL : 'not run (no OPENROUTER_API_KEY)'}. Generated ${new Date().toISOString()}.

| Method | Injected edits marked red | Injected edits flagged (red or amber) | Safe edits wrongly marked red |
|---|---|---|---|
${line('Overlap only', ov)}
${jd ? line('Overlap + Haiku judge', jd) : '| Overlap + Haiku judge | not run | not run | not run |'}

## Per edit

| Scenario | Edit | Truth | Overlap | Judge |
|---|---|---|---|---|
${rows.map((r) => `| ${r.scenario} | ${r.label} | ${r.injected ? 'injected' : 'safe'} | ${r.overlap} | ${r.judge ?? '-'} |`).join('\n')}
`

mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/eval-report.md', md)
writeFileSync('evidence/eval-results.json', JSON.stringify({ overlap: ov, judge: jd, rows }, null, 2))
console.log(md)
