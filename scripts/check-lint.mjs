import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baselinePath = resolve(root, 'lint/shrink-only.json')
const write = process.argv.includes('--write')

const run = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), ['--type-aware', '-f', 'json'], { cwd: root, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })
if (run.error) {throw run.error}
if (run.status !== 0 && run.status !== 1) {
  console.error(run.stderr)
  throw new Error(`oxlint exited with ${run.status}`)
}
let report
try {
  report = JSON.parse(run.stdout)
} catch {
  console.error(run.stdout, run.stderr)
  throw new Error('oxlint did not print a JSON report')
}
if (!Array.isArray(report.diagnostics) || !(report.number_of_files > 0)) {
  console.error(run.stderr)
  throw new Error('oxlint linted no files')
}

const actual = {}
for (const diagnostic of report.diagnostics) {
  const byFile = (actual[diagnostic.code] ??= {})
  byFile[diagnostic.filename] = (byFile[diagnostic.filename] ?? 0) + 1
}
const parseBaseline = (text, source) => {
  const parsed = JSON.parse(text)
  for (const [code, byFile] of Object.entries(parsed)) {
    for (const [file, count] of Object.entries(byFile)) {
      if (!Number.isInteger(count) || count < 1) {throw new Error(`${source}: ${code} in ${file} has count ${JSON.stringify(count)}. Use a positive integer.`)}
    }
  }
  return parsed
}
const total = (byFile = {}) => Object.values(byFile).reduce((sum, count) => sum + count, 0)
const baseline = parseBaseline(readFileSync(baselinePath, 'utf-8'), 'lint/shrink-only.json')

const base = process.env.LINT_BASE
if (base) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('cat-file', '-e', `${base}^{commit}`)
  if (git('ls-tree', '--name-only', base, '--', 'lint/shrink-only.json').trim() === '') {
    console.log(`The base ${base} has no lint/shrink-only.json, so this run sets the first baseline.`)
  } else {
    const baseBaseline = parseBaseline(git('show', `${base}:lint/shrink-only.json`), `${base}:lint/shrink-only.json`)
    const grown = Object.keys(baseline).filter((code) => total(baseline[code]) > total(baseBaseline[code]))
    for (const code of grown) {
      console.error(`lint/shrink-only.json allows ${total(baseline[code])} ${code} in total, and the base allows ${total(baseBaseline[code])}. A baseline can only shrink. Fix the new findings.`)
    }
    if (grown.length > 0) {process.exit(1)}
  }
}

const over = []
const under = []
for (const code of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
  for (const file of new Set([...Object.keys(actual[code] ?? {}), ...Object.keys(baseline[code] ?? {})])) {
    const count = actual[code]?.[file] ?? 0
    const allowed = baseline[code]?.[file] ?? 0
    if (count > allowed) {over.push({ code, file, count, allowed })}
    if (count < allowed) {under.push({ code, file, count, allowed })}
  }
}

for (const { code, file, count, allowed } of over) {
  console.error(`${file}: ${code} has ${count}, lint/shrink-only.json allows ${allowed}. Fix the new ones; the count can only shrink.`)
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.code === code && diagnostic.filename === file) {
      console.error(`  ${file}:${diagnostic.labels?.[0]?.span.line ?? '?'} ${diagnostic.message}`)
    }
  }
}
if (over.length > 0) {process.exit(1)}

if (under.length > 0 && write) {
  const sorted = Object.fromEntries(Object.keys(actual).toSorted().map((code) => [code, Object.fromEntries(Object.entries(actual[code]).toSorted(([a], [b]) => (a < b ? -1 : 1)))]))
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`Lowered ${under.length} counts in lint/shrink-only.json.`)
} else if (under.length > 0) {
  for (const { code, file, count, allowed } of under) {
    console.error(`${file}: ${code} has ${count}, lint/shrink-only.json allows ${allowed}. Lower the count, or run npm run lint -- --write.`)
  }
  process.exit(1)
}

console.log(`Lint matches lint/shrink-only.json: ${report.diagnostics.length} known findings in ${report.number_of_files} files.`)
