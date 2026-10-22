import { useMemo } from 'react'
import type { ContextEvent, WriteEvent } from '#/server/queries'
import { Diff, diffStats } from './DiffView'
import {
  type Excerpt,
  type Range,
  describeInput,
  excerpt,
  explain,
  headlineFor,
  splitOverlapReason,
  v,
} from './explain'
import { Time, VerdictChip, verdictVar } from './ui'

export function Highlighted({ text, ranges, tone }: { text: string; ranges: Range[]; tone: 'red' | 'amber' | 'green' }) {
  const parts: React.ReactNode[] = []
  let pos = 0
  for (const [s, e] of ranges) {
    if (s > pos) parts.push(text.slice(pos, s))
    parts.push(
      <mark key={s} className={`hl hl-${tone}`}>
        {text.slice(s, e)}
      </mark>,
    )
    pos = e
  }
  parts.push(text.slice(pos))
  return <>{parts}</>
}

function SourceQuote({
  cause,
  ex,
  cwd,
  tone,
}: {
  cause: ContextEvent
  ex: Excerpt | null
  cwd: string | null
  tone: 'red' | 'amber' | 'green'
}) {
  const info = describeInput(cause, cwd)
  const c = verdictVar[tone]
  const href = cause.source_ref && /^https?:\/\//.test(cause.source_ref) ? cause.source_ref : null
  return (
    <figure className="m-0 rounded-lg bg-panel-2 p-4" style={{ boxShadow: `inset 3px 0 0 ${c}` }}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-semibold text-fg">{info.label}</span>
        {info.detail &&
          (href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="font-mono text-[13px] text-link underline-offset-2 hover:underline">
              {info.detail}
            </a>
          ) : (
            <span className="font-mono text-[13px]">{info.detail}</span>
          ))}
        {ex?.hidden && (
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: c, background: `color-mix(in oklab, ${c} 16%, transparent)` }}>
            Hidden in an HTML comment
          </span>
        )}
      </figcaption>
      {ex ? (
        <blockquote className="m-0 whitespace-pre-wrap break-words text-[17px] leading-relaxed text-fg">
          {ex.clippedStart && '… '}
          <Highlighted text={ex.text} ranges={ex.ranges} tone={tone} />
          {ex.clippedEnd && ' …'}
        </blockquote>
      ) : (
        <p className="m-0 line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-muted">
          {cause.content.slice(0, 500)}
        </p>
      )}
    </figure>
  )
}

export function EditCard({
  write,
  ctx,
  cwd,
  fresh,
}: {
  write: WriteEvent
  ctx: Map<string, ContextEvent>
  cwd: string | null
  fresh: boolean
}) {
  const verdict = v(write.verdict)
  const e = useMemo(() => explain(write, ctx), [write, ctx])
  const info = e.cause ? describeInput(e.cause, cwd) : null
  const { added, removed } = useMemo(() => diffStats(write.old_text, write.new_text), [write.old_text, write.new_text])
  const tone = verdict === 'red' || verdict === 'amber' ? verdict : 'green'
  const ex = useMemo(() => (e.cause ? excerpt(e.cause.content, e.fragments) : null), [e])
  const showSource = (verdict === 'red' || verdict === 'amber') && e.cause
  const dir = write.file_path.includes('/') ? write.file_path.slice(0, write.file_path.lastIndexOf('/') + 1) : ''
  const name = write.file_path.slice(dir.length)
  const c = verdictVar[verdict]

  return (
    <article
      id={`w-${write.id}`}
      className={`scroll-mt-24 rounded-xl border bg-panel ${fresh ? 'enter' : ''}`}
      style={{ borderColor: verdict === 'red' ? `color-mix(in oklab, ${c} 55%, transparent)` : 'var(--color-line)' }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4">
        <VerdictChip verdict={verdict} />
        <h3 className="m-0 min-w-0 truncate font-mono text-[16px] font-medium">
          <span className="text-muted">{dir}</span>
          <span className="text-fg">{name}</span>
        </h3>
        <span className="ml-auto flex items-center gap-3 font-mono text-sm tabular-nums">
          <span className="text-fg">+{added}</span>
          <span className="text-muted">−{removed}</span>
          <Time ts={write.ts} className="text-faint" />
        </span>
      </header>

      <div className="space-y-4 px-5 pt-3 pb-5">
        <p className="m-0 text-[18px] font-medium leading-snug text-balance" style={{ color: verdict === 'green' || verdict === 'pending' ? 'var(--color-fg)' : c }}>
          {headlineFor(verdict, info)}
        </p>
        {e.why && verdict !== 'pending' && (
          <p className="m-0 max-w-[75ch] text-[16px] leading-relaxed text-muted text-pretty">{e.why}</p>
        )}

        {showSource && e.cause && <SourceQuote cause={e.cause} ex={ex} cwd={cwd} tone={tone} />}

        <Diff path={write.file_path} oldText={write.old_text} newText={write.new_text} verdict={verdict} />

        {write.attributions.length > 0 && <Signals write={write} ctx={ctx} cwd={cwd} />}
      </div>
    </article>
  )
}

function Signals({ write, ctx, cwd }: { write: WriteEvent; ctx: Map<string, ContextEvent>; cwd: string | null }) {
  const n = write.attributions.length
  return (
    <details className="group text-sm">
      <summary className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-md text-muted hover:text-fg">
        <span aria-hidden className="inline-block transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        How we decided ({n} signal{n === 1 ? '' : 's'})
      </summary>
      <ul className="m-0 mt-2 list-none space-y-2 p-0">
        {write.attributions.map((a) => {
          const info = describeInput(ctx.get(a.context_id), cwd)
          const { text, fragment } = splitOverlapReason(a.reason)
          return (
            <li key={`${a.context_id}-${a.method}`} className="rounded-lg bg-panel-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <VerdictChip verdict={v(a.verdict)} size="sm" />
                <span className="font-medium text-fg">{a.method === 'llm' ? 'AI review' : 'Text match'}</span>
                <span className="text-muted">
                  against {info.label.toLowerCase()}
                  {info.detail ? ` · ${info.detail}` : ''}
                </span>
                <span className="ml-auto tabular-nums text-faint">{Math.round(a.confidence * 100)}% sure</span>
              </div>
              {text && <p className="m-0 mt-1.5 leading-relaxed text-muted">{text}</p>}
              {fragment && (
                <p className="m-0 mt-1.5 text-muted">
                  Matched text: <code className="code rounded bg-code px-1.5 py-0.5 text-fg">{fragment}</code>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
