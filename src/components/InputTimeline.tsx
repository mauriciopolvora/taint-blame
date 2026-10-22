import { useMemo, useState } from 'react'
import type { ContextEvent, WriteEvent } from '#/server/queries'
import { Highlighted } from './EditCard'
import { type InputKind, type VerdictOrPending, basename, describeInput, explain, findRanges, v } from './explain'
import { Time, verdictVar } from './ui'

const ICON: Record<InputKind, string> = {
  prompt: '›',
  file: '▤',
  'search-files': '⌕',
  command: '$',
  web: '◎',
  'web-search': '⌕',
  github: '#',
  tool: '⧉',
  agent: '◇',
}

type Item = { kind: 'ctx'; c: ContextEvent; ts: number; o: number } | { kind: 'write'; w: WriteEvent; ts: number; o: number }

export function jumpToEdit(id: string) {
  const el = document.getElementById(`w-${id}`)
  if (!el) return
  const details = el.closest('details')
  if (details && !details.open) details.open = true
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

export function InputTimeline({
  contexts,
  writes,
  ctxMap,
  cwd,
  isFresh,
}: {
  contexts: ContextEvent[]
  writes: WriteEvent[]
  ctxMap: Map<string, ContextEvent>
  cwd: string | null
  isFresh: (id: string) => boolean
}) {
  const [outsideOnly, setOutsideOnly] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  // input id -> worst verdict among edits it caused, plus fragments to highlight
  const caused = useMemo(() => {
    const m = new Map<string, { verdict: VerdictOrPending; n: number; frags: string[] }>()
    for (const w of writes) {
      const verdict = v(w.verdict)
      if (verdict !== 'red' && verdict !== 'amber') continue
      const e = explain(w, ctxMap)
      if (!e.cause) continue
      const prev = m.get(e.cause.id)
      m.set(e.cause.id, {
        verdict: prev?.verdict === 'red' ? 'red' : verdict,
        n: (prev?.n ?? 0) + 1,
        frags: [...(prev?.frags ?? []), ...e.fragments],
      })
    }
    return m
  }, [writes, ctxMap])

  const items = useMemo(() => {
    const cs = outsideOnly ? contexts.filter((c) => c.trust === 'untrusted') : contexts
    const list: Item[] = [
      ...cs.map((c, i) => ({ kind: 'ctx' as const, c, ts: c.ts, o: i })),
      ...writes.map((w, i) => ({ kind: 'write' as const, w, ts: w.ts, o: 100_000 + i })),
    ]
    return list.sort((a, b) => a.ts - b.ts || a.o - b.o)
  }, [contexts, writes, outsideOnly])

  const outsideCount = contexts.filter((c) => c.trust === 'untrusted').length

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <section aria-labelledby="timeline-h" className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h2 id="timeline-h" className="m-0 text-base font-semibold">
          What the agent read
          <span className="ml-2 font-normal text-muted tabular-nums">{contexts.length}</span>
        </h2>
        <label className="ml-auto flex min-h-8 cursor-pointer select-none items-center gap-2 text-sm text-muted hover:text-fg">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-v-red)]"
            checked={outsideOnly}
            onChange={(e) => setOutsideOnly(e.target.checked)}
          />
          Outside only ({outsideCount})
        </label>
      </header>

      <ol className="scroll-thin m-0 max-h-[calc(100vh-11rem)] list-none overflow-y-auto overscroll-contain p-2">
        {items.map((it) => {
          if (it.kind === 'write') {
            const w = it.w
            const verdict = v(w.verdict)
            return (
              <li key={`w-${w.id}`} className={isFresh(w.id) ? 'enter' : ''}>
                <button
                  type="button"
                  onClick={() => jumpToEdit(w.id)}
                  className="press flex min-h-9 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
                >
                  <span className="flex w-5 shrink-0 justify-center" aria-hidden>
                    <span className="size-2.5 rounded-full" style={{ background: verdictVar[verdict] }} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    <span className="text-muted">Edited </span>
                    <span className="font-mono text-[14px] text-fg">{basename(w.file_path)}</span>
                  </span>
                  <Time ts={w.ts} className="shrink-0 text-xs text-faint" />
                </button>
              </li>
            )
          }

          const c = it.c
          const info = describeInput(c, cwd)
          const isOpen = open.has(c.id)
          const hit = caused.get(c.id)
          const hc = hit ? verdictVar[hit.verdict] : undefined
          return (
            <li key={c.id} className={isFresh(c.id) ? 'enter' : ''}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(c.id)}
                className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-panel-2"
                style={hit ? { background: `color-mix(in oklab, ${hc} 10%, transparent)`, boxShadow: `inset 3px 0 0 ${hc}` } : undefined}
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold"
                  style={{
                    color: info.outside ? 'var(--color-outside)' : 'var(--color-muted)',
                    background: info.outside ? 'color-mix(in oklab, var(--color-outside) 16%, transparent)' : 'var(--color-panel-2)',
                  }}
                >
                  {ICON[info.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-fg">{info.label}</span>
                    {info.outside && (
                      <span className="rounded px-1.5 text-xs font-medium" style={{ color: 'var(--color-outside)', background: 'color-mix(in oklab, var(--color-outside) 14%, transparent)' }}>
                        outside
                      </span>
                    )}
                    <Time ts={c.ts} className="ml-auto shrink-0 text-xs text-faint" />
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted" title={info.detail || undefined}>
                    {info.kind === 'prompt' ? c.content : info.detail || c.content.slice(0, 120)}
                  </span>
                  {hit && (
                    <span className="mt-1 block text-sm font-medium" style={{ color: hc }}>
                      Led to {hit.n} {hit.verdict === 'red' ? 'injected' : 'borrowed'} edit{hit.n === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </button>
              {isOpen && (
                <pre className="code scroll-thin mx-2 mt-1 mb-2 ml-10 max-h-80 overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-md bg-code p-3 text-fg/90">
                  {hit ? (
                    <Highlighted
                      text={c.content}
                      ranges={findRanges(c.content, hit.frags)}
                      tone={hit.verdict === 'red' ? 'red' : 'amber'}
                    />
                  ) : (
                    c.content
                  )}
                </pre>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
