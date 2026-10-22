export type DiffRow =
  | { kind: 'ctx'; text: string; oldNo: number; newNo: number }
  | { kind: 'del'; text: string; oldNo: number }
  | { kind: 'add'; text: string; newNo: number }

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

const MAX_CELLS = 4_000_000

// Line-level LCS diff. Falls back to "all removed, all added" for huge inputs.
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)

  // Trim common prefix/suffix so the LCS table stays small.
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++

  const rows: DiffRow[] = []
  for (let i = 0; i < pre; i++) rows.push({ kind: 'ctx', text: a[i], oldNo: i + 1, newNo: i + 1 })

  const am = a.slice(pre, a.length - suf)
  const bm = b.slice(pre, b.length - suf)
  const n = am.length
  const m = bm.length

  if (n * m > MAX_CELLS) {
    am.forEach((t, i) => rows.push({ kind: 'del', text: t, oldNo: pre + i + 1 }))
    bm.forEach((t, j) => rows.push({ kind: 'add', text: t, newNo: pre + j + 1 }))
  } else {
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        rows.push({ kind: 'ctx', text: am[i], oldNo: pre + i + 1, newNo: pre + j + 1 })
        i++
        j++
      } else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
        rows.push({ kind: 'add', text: bm[j], newNo: pre + j + 1 })
        j++
      } else {
        rows.push({ kind: 'del', text: am[i], oldNo: pre + i + 1 })
        i++
      }
    }
  }

  for (let k = 0; k < suf; k++) {
    const oi = a.length - suf + k
    const ni = b.length - suf + k
    rows.push({ kind: 'ctx', text: a[oi], oldNo: oi + 1, newNo: ni + 1 })
  }
  return rows
}

export type Segment = { type: 'rows'; rows: DiffRow[] } | { type: 'gap'; rows: DiffRow[] }

// Collapse unchanged runs longer than 2*context+1 into expandable gaps.
export function withContext(rows: DiffRow[], context = 3): Segment[] {
  const changed = rows.map((r) => r.kind !== 'ctx')
  const keep = rows.map(() => false)
  rows.forEach((_, i) => {
    if (!changed[i]) return
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true
  })
  const segs: Segment[] = []
  let i = 0
  while (i < rows.length) {
    const kept = keep[i]
    let j = i
    while (j < rows.length && keep[j] === kept) j++
    const slice = rows.slice(i, j)
    if (kept || slice.length <= 2) segs.push({ type: 'rows', rows: slice })
    else segs.push({ type: 'gap', rows: slice })
    i = j
  }
  return segs
}

// "Changed lines" of a write = lines of new_text (a deletion-only edit counts as 1).
export function changedLines(newText: string): number {
  return Math.max(1, splitLines(newText).length)
}
