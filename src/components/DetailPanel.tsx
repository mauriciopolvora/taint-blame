import { useEffect, useRef } from 'react'
import type { Attribution, ContextEvent, WriteEvent } from '#/server/queries'
import { sourceLabel } from './Hunk'
import { Time, TrustChip, VERDICT_HINT, VerdictChip, v, verdictVar } from './ui'

// Pull quoted fragments out of an attribution reason: "..." `...` “...”.
export function fragmentsOf(reason: string | null): string[] {
  if (!reason) return []
  const out: string[] = []
  const re = /"([^"]{6,})"|“([^”]{6,})”|`([^`]{6,})`/g
  for (const m of reason.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3]).trim())
  return out
}

type Range = [number, number]

function findRanges(content: string, frags: string[]): Range[] {
  const lower = content.toLowerCase()
  const ranges: Range[] = []
  for (const f of frags) {
    const variants = [f, f.replace(/`/g, '')]
    for (const needle of variants) {
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

function Snippet({ content, ranges, verdict }: { content: string; ranges: Range[]; verdict: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    const mark = el?.querySelector('mark')
    if (el && mark instanceof HTMLElement) el.scrollTop = Math.max(0, mark.offsetTop - 40)
  }, [content, ranges])

  const parts: React.ReactNode[] = []
  let pos = 0
  ranges.forEach(([s, e], i) => {
    if (s > pos) parts.push(content.slice(pos, s))
    parts.push(
      // biome-ignore lint/suspicious/noArrayIndexKey: positional
      <mark key={i} className={`frag ${verdict === 'red' ? 'frag-red' : verdict === 'green' ? 'frag-green' : ''}`}>
        {content.slice(s, e)}
      </mark>,
    )
    pos = e
  })
  parts.push(content.slice(pos))

  return (
    <pre
      ref={ref}
      className="code scroll-thin relative m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg p-3 text-[12px] leading-[18px] text-fg/85"
    >
      {parts}
    </pre>
  )
}

function AttributionCard({ a, ctx }: { a: Attribution; ctx: ContextEvent | undefined }) {
  const ranges = ctx ? findRanges(ctx.content, fragmentsOf(a.reason)) : []
  const c = verdictVar[v(a.verdict)]
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <VerdictChip verdict={v(a.verdict)} />
        <span className="font-mono text-[11px] text-muted">{a.method}</span>
        <div className="ml-auto flex items-center gap-2" title={`confidence ${a.confidence.toFixed(2)}`}>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${Math.round(a.confidence * 100)}%`, background: c }} />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted">{Math.round(a.confidence * 100)}%</span>
        </div>
      </div>
      <div className="space-y-2.5 p-3">
        {a.reason && <p className="m-0 text-[13px] leading-relaxed text-fg">{a.reason}</p>}
        {ctx ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <TrustChip trust={ctx.trust} />
              <span className="font-mono text-muted">{ctx.source}</span>
              <Time ts={ctx.ts} className="ml-auto font-mono text-[11px] text-faint" />
            </div>
            {ctx.source_ref && (
              <div className="truncate font-mono text-[12px] text-t-trusted" title={ctx.source_ref}>
                {/^https?:\/\//.test(ctx.source_ref) ? (
                  <a href={ctx.source_ref} target="_blank" rel="noreferrer noopener" className="hover:underline">
                    {ctx.source_ref}
                  </a>
                ) : (
                  ctx.source_ref
                )}
              </div>
            )}
            <Snippet content={ctx.content} ranges={ranges} verdict={a.verdict} />
          </>
        ) : (
          <p className="m-0 text-xs text-faint">Input {a.context_id} not found in this session.</p>
        )}
      </div>
    </div>
  )
}

export function DetailPanel({
  write,
  contexts,
  onClose,
}: {
  write: WriteEvent
  contexts: Map<string, ContextEvent>
  onClose: () => void
}) {
  const verdict = v(write.verdict)
  const c = verdictVar[verdict]
  const primary = write.attributions.find((a) => a.verdict === write.verdict) ?? write.attributions[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="scroll-thin fixed inset-y-0 right-0 z-30 flex w-[min(520px,100vw)] flex-col overflow-y-auto border-l border-line-2 bg-panel-2 shadow-[-24px_0_48px_rgba(0,0,0,0.45)]">
      <div className="h-1 shrink-0" style={{ background: c }} />
      <header className="sticky top-0 z-10 border-b border-line bg-panel-2/95 px-5 py-4 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <VerdictChip verdict={verdict} size="md" />
              <Time ts={write.ts} className="font-mono text-xs text-faint" />
            </div>
            <h2 className="mt-2 mb-0 truncate font-mono text-[15px] font-medium text-fg">{write.file_path}</h2>
            <p className="mt-1 mb-0 text-[13px] text-muted">{VERDICT_HINT[verdict]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 font-mono text-xs text-muted hover:bg-line hover:text-fg"
            aria-label="Close detail panel"
          >
            esc ✕
          </button>
        </div>
        {primary && verdict !== 'pending' && (
          <p className="mt-3 mb-0 text-sm text-fg">
            Written after reading <span className="font-semibold">{sourceLabel(contexts.get(primary.context_id))}</span>
          </p>
        )}
      </header>

      <div className="space-y-3 p-5">
        <h3 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
          Attributed sources · {write.attributions.length}
        </h3>
        {write.attributions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-2 p-4 text-sm text-muted">
            {verdict === 'pending'
              ? 'Attribution has not run for this edit yet.'
              : 'No attribution rows for this edit.'}{' '}
            The agent had read {write.context_ids.length} input{write.context_ids.length === 1 ? '' : 's'} before writing
            it.
          </div>
        ) : (
          write.attributions.map((a) => (
            <AttributionCard key={`${a.context_id}-${a.method}`} a={a} ctx={contexts.get(a.context_id)} />
          ))
        )}
      </div>
    </aside>
  )
}
