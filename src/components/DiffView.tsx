import { useMemo, useState } from 'react'
import { type DiffRow, lineDiff, withContext } from './diff'
import type { VerdictOrPending } from './explain'
import { langFor, type Tok, useTokens } from './highlight'
import { verdictVar } from './ui'

function Code({ text, tokens }: { text: string; tokens?: Tok[] }) {
  if (!tokens) return <>{text || ' '}</>
  if (tokens.length === 0) return <> </>
  return (
    <>
      {tokens.map((t, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
          key={i}
          style={{
            color: t.color,
            fontStyle: t.fontStyle && t.fontStyle & 1 ? 'italic' : undefined,
            fontWeight: t.fontStyle && t.fontStyle & 2 ? 600 : undefined,
          }}
        >
          {t.content}
        </span>
      ))}
    </>
  )
}

export function diffStats(oldText: string, newText: string) {
  const rows = lineDiff(oldText, newText)
  return { added: rows.filter((r) => r.kind === 'add').length, removed: rows.filter((r) => r.kind === 'del').length }
}

export function Diff({
  path,
  oldText,
  newText,
  verdict,
}: {
  path: string
  oldText: string
  newText: string
  verdict: VerdictOrPending
}) {
  const color = verdictVar[verdict]
  const lang = langFor(path)
  const oldTok = useTokens(oldText, lang)
  const newTok = useTokens(newText, lang)
  const rows = useMemo(() => lineDiff(oldText, newText), [oldText, newText])
  const segments = useMemo(() => withContext(rows, 2), [rows])
  const [open, setOpen] = useState<Set<number>>(new Set())

  const strength = verdict === 'red' ? 22 : verdict === 'amber' ? 16 : 10
  const bg = (r: DiffRow) =>
    r.kind === 'add'
      ? `color-mix(in oklab, ${color} ${strength}%, transparent)`
      : r.kind === 'del'
        ? 'var(--color-del)'
        : undefined

  const renderRow = (r: DiffRow, key: string) => {
    const toks = r.kind === 'del' ? oldTok?.[r.oldNo - 1] : newTok?.[r.newNo - 1]
    return (
      <div key={key} className="flex min-w-max" style={{ background: bg(r) }}>
        <span
          className="w-1 shrink-0"
          style={{ background: r.kind === 'add' ? color : r.kind === 'del' ? 'var(--color-line-2)' : 'transparent' }}
        />
        <span className="w-12 shrink-0 select-none pr-3 text-right text-faint">{r.kind !== 'del' ? r.newNo : ''}</span>
        <span
          className="w-5 shrink-0 select-none text-center"
          style={{ color: r.kind === 'add' ? color : 'var(--color-faint)' }}
          aria-hidden
        >
          {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}
        </span>
        <span className={`whitespace-pre pr-6 ${r.kind === 'del' ? 'opacity-60' : ''}`}>
          <Code text={r.text} tokens={toks} />
        </span>
      </div>
    )
  }

  return (
    <div className="code scroll-thin overflow-x-auto rounded-lg bg-code py-1.5">
      {rows.length === 0 && <div className="px-4 py-2 text-faint">(empty edit)</div>}
      {segments.map((seg, si) =>
        seg.type === 'rows' || open.has(si) ? (
          seg.rows.map((r, ri) => renderRow(r, `${si}-${ri}`))
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={si}
            type="button"
            onClick={() => setOpen((s) => new Set(s).add(si))}
            className="flex w-full items-center gap-2 py-1 pl-[68px] text-left text-[13px] text-faint hover:bg-panel-2 hover:text-muted"
          >
            ⋯ {seg.rows.length} unchanged lines
          </button>
        ),
      )}
    </div>
  )
}
