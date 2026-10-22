import { useMemo, useState } from 'react'
import type { ContextEvent, WriteEvent } from '#/server/queries'
import { type DiffRow, lineDiff, withContext } from './diff'
import { langFor, type Tok, useTokens } from './highlight'
import { Time, VERDICT_LABEL, type VerdictOrPending, v, verdictVar } from './ui'

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

export function sourceLabel(c: ContextEvent | undefined): string {
  if (!c) return 'unknown input'
  const ref = c.source_ref ?? ''
  const gh = ref.match(/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/(\d+)/)
  if (gh) return `${gh[1] === 'pull' ? 'PR' : 'issue'} #${gh[2]}`
  if (/^https?:\/\//.test(ref)) {
    try {
      return new URL(ref).hostname.replace(/^www\./, '')
    } catch {
      return ref
    }
  }
  if (c.source === 'user_prompt') return 'user prompt'
  return ref || c.source
}

type Props = {
  write: WriteEvent
  contexts: Map<string, ContextEvent>
  selected: boolean
  onSelect: () => void
}

export function Hunk({ write, contexts, selected, onSelect }: Props) {
  const verdict = v(write.verdict)
  const color = verdictVar[verdict]
  const lang = langFor(write.file_path)
  const oldTok = useTokens(write.old_text, lang)
  const newTok = useTokens(write.new_text, lang)
  const rows = useMemo(() => lineDiff(write.old_text, write.new_text), [write.old_text, write.new_text])
  const segments = useMemo(() => withContext(rows), [rows])
  const [open, setOpen] = useState<Set<number>>(new Set())

  const added = rows.filter((r) => r.kind === 'add').length
  const removed = rows.filter((r) => r.kind === 'del').length

  // Strongest attribution for the blame cell: the one matching the verdict.
  const top =
    write.attributions.find((a) => a.verdict === write.verdict && a.context_id) ?? write.attributions[0] ?? null
  const topCtx = top ? contexts.get(top.context_id) : undefined

  const tint = (r: DiffRow) => {
    if (r.kind === 'add') return `color-mix(in oklab, ${color} ${verdict === 'pending' ? 8 : 13}%, transparent)`
    if (r.kind === 'del') return 'rgba(139,150,165,0.07)'
    return undefined
  }

  const renderRow = (r: DiffRow, key: string) => {
    const toks = r.kind === 'del' ? oldTok?.[r.oldNo - 1] : newTok?.[r.newNo - 1]
    return (
      <div key={key} className="flex min-w-max" style={{ background: tint(r) }}>
        <span
          className="w-1 shrink-0"
          style={{ background: r.kind === 'add' ? color : r.kind === 'del' ? 'var(--color-line-2)' : 'transparent' }}
        />
        <span className="w-10 shrink-0 select-none pr-2 text-right text-faint">{r.kind !== 'add' ? r.oldNo : ''}</span>
        <span className="w-10 shrink-0 select-none pr-2 text-right text-faint">{r.kind !== 'del' ? r.newNo : ''}</span>
        <span
          className="w-5 shrink-0 select-none text-center"
          style={{ color: r.kind === 'add' ? color : 'var(--color-faint)' }}
        >
          {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}
        </span>
        <span className={`whitespace-pre pr-6 ${r.kind === 'del' ? 'opacity-55' : ''}`}>
          <Code text={r.text} tokens={toks} />
        </span>
      </div>
    )
  }

  return (
    <div
      id={`w-${write.id}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
      className={`group flex cursor-pointer border-t border-line transition-colors first:border-t-0 ${
        selected ? 'bg-panel-2' : 'hover:bg-panel-2/60'
      }`}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${color}` } : undefined}
    >
      {/* Blame cell */}
      <div
        className="relative w-64 shrink-0 border-r border-line px-3 py-2.5"
        style={{ background: `color-mix(in oklab, ${color} 6%, transparent)` }}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
            {VERDICT_LABEL[verdict as VerdictOrPending]}
          </span>
          <Time ts={write.ts} className="font-mono text-[11px] text-faint" />
        </div>
        <div className="mt-1.5 text-[13px] leading-snug text-fg">
          {verdict === 'pending' ? (
            <span className="text-muted">Awaiting attribution</span>
          ) : topCtx ? (
            <>
              <span className="text-muted">from </span>
              <span className="font-medium">{sourceLabel(topCtx)}</span>
            </>
          ) : (
            <span className="text-muted">No attributed input</span>
          )}
        </div>
        {top?.reason && verdict !== 'pending' && (
          <p className="mt-1 line-clamp-3 text-xs leading-snug text-muted">{top.reason}</p>
        )}
        <div className="mt-2 flex items-center gap-2 font-mono text-[11px]">
          <span className="text-v-green">+{added}</span>
          <span className="text-muted">−{removed}</span>
          {write.attributions.length > 0 && (
            <span className="ml-auto text-faint group-hover:text-muted">
              {write.attributions.length} source{write.attributions.length === 1 ? '' : 's'} →
            </span>
          )}
        </div>
      </div>

      {/* Diff */}
      <div className="code scroll-thin min-w-0 flex-1 overflow-x-auto py-1">
        {rows.length === 0 && <div className="px-4 py-2 text-faint">(empty edit)</div>}
        {segments.map((seg, si) =>
          seg.type === 'rows' || open.has(si) ? (
            seg.rows.map((r, ri) => renderRow(r, `${si}-${ri}`))
          ) : (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
              key={si}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOpen((s) => new Set(s).add(si))
              }}
              className="flex w-full items-center gap-2 bg-bg/60 px-4 py-0.5 text-left text-[12px] text-faint hover:text-muted"
            >
              <span className="w-[76px] text-right">⋯</span>
              {seg.rows.length} unchanged lines
            </button>
          ),
        )}
      </div>
    </div>
  )
}
