import { useState } from 'react'
import type { ContextEvent, Verdict, WriteEvent } from '#/server/queries'
import { Time, TrustChip, v, verdictVar, trustVar } from './ui'

export type TimelineItem = { kind: 'ctx'; ctx: ContextEvent } | { kind: 'write'; write: WriteEvent }

const SOURCE_ICON: Record<string, string> = {
  user_prompt: '›',
  prompt: '›',
  file_read: '▤',
  read: '▤',
  web_fetch: '◎',
  web_search: '◎',
  bash: '$',
  mcp: '⧉',
}

function basename(p: string) {
  return p.split('/').pop() ?? p
}

export function Timeline({
  items,
  influence,
  highlighted,
  selectedWrite,
  onSelectWrite,
}: {
  items: TimelineItem[]
  // context id -> verdicts of writes it was attributed to
  influence: Map<string, Verdict[]>
  // context id -> verdict of the attribution to the selected write
  highlighted: Map<string, Verdict>
  selectedWrite: string | null
  onSelectWrite: (id: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  if (items.length === 0) return <p className="px-4 py-6 text-sm text-faint">Nothing to show.</p>

  return (
    <ol className="relative m-0 list-none p-0">
      <span className="absolute top-3 bottom-3 left-[23px] w-px bg-line" aria-hidden />
      {items.map((it) => {
        if (it.kind === 'write') {
          const w = it.write
          const verdict = v(w.verdict)
          const c = verdictVar[verdict]
          const sel = selectedWrite === w.id
          return (
            <li key={`w-${w.id}`} className="relative">
              <button
                type="button"
                onClick={() => onSelectWrite(w.id)}
                className={`flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-panel-2 ${sel ? 'bg-panel-2' : ''}`}
              >
                <span
                  className="relative z-10 flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-bg"
                  style={{ background: c, marginLeft: 0 }}
                >
                  ✎
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: c }}>
                  wrote {basename(w.file_path)}
                </span>
                <Time ts={w.ts} className="shrink-0 font-mono text-[10px] text-faint" />
              </button>
            </li>
          )
        }

        const c = it.ctx
        const isOpen = open.has(c.id)
        const hl = highlighted.get(c.id)
        const infl = influence.get(c.id) ?? []
        const tColor = trustVar[c.trust]
        return (
          <li key={c.id} className="relative">
            <button
              type="button"
              onClick={() => toggle(c.id)}
              className={`flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-panel-2 ${isOpen ? 'bg-panel-2/70' : ''}`}
              style={hl ? { boxShadow: `inset 3px 0 0 ${verdictVar[hl]}`, background: `color-mix(in oklab, ${verdictVar[hl]} 9%, transparent)` } : undefined}
            >
              <span
                className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] leading-none"
                style={{ borderColor: tColor, color: tColor, background: 'var(--color-panel)' }}
              >
                {SOURCE_ICON[c.source] ?? '•'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-medium text-fg">{c.source}</span>
                  <TrustChip trust={c.trust} />
                  <Time ts={c.ts} className="ml-auto shrink-0 font-mono text-[10px] text-faint" />
                </span>
                {c.source_ref && (
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted" title={c.source_ref}>
                    {c.source_ref}
                  </span>
                )}
                {!isOpen && (
                  <span className="mt-0.5 block truncate text-[12px] text-faint">{c.content.slice(0, 140)}</span>
                )}
                {infl.length > 0 && (
                  <span className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted">
                    influenced
                    {infl.map((iv, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional
                      <span key={i} className="size-2 rounded-full" style={{ background: verdictVar[iv] }} />
                    ))}
                  </span>
                )}
              </span>
            </button>
            {isOpen && (
              <pre className="code scroll-thin mx-4 mt-0 mb-2 ml-11 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg p-2.5 text-[11.5px] leading-[17px] text-fg/80">
                {c.content}
              </pre>
            )}
          </li>
        )
      })}
    </ol>
  )
}
