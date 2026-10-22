import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DetailPanel } from '#/components/DetailPanel'
import { Hunk } from '#/components/Hunk'
import { Timeline, type TimelineItem } from '#/components/Timeline'
import {
  AgentBadge,
  Logo,
  type Split,
  SplitBar,
  Time,
  VERDICT_HINT,
  VERDICT_LABEL,
  type VerdictOrPending,
  pct,
  repoName,
  v,
  verdictVar,
} from '#/components/ui'
import { changedLines } from '#/components/diff'
import { type ContextEvent, type Verdict, type WriteEvent, getSession } from '#/server/queries'

export const Route = createFileRoute('/sessions/$id')({
  loader: async ({ params }) => {
    const data = await getSession({ data: params.id })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${repoName(loaderData.session.cwd)} · Taint Blame` : 'Taint Blame' }],
  }),
  component: SessionPage,
})

const isInfluenced = (w: WriteEvent) => w.verdict === 'red' || w.verdict === 'amber'
const RANK: Record<VerdictOrPending, number> = { red: 3, amber: 2, pending: 1, green: 0 }

function SessionPage() {
  const { session, contexts, writes } = Route.useLoaderData()
  const [untrustedOnly, setUntrustedOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const ctxMap = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts])
  const selected = writes.find((w) => w.id === selectedId) ?? null

  const split = useMemo(() => {
    const s: Split = { red: 0, amber: 0, green: 0, pending: 0 }
    for (const w of writes) s[v(w.verdict)] += changedLines(w.new_text)
    return s
  }, [writes])
  const total = split.red + split.amber + split.green + split.pending
  const influenced = split.red + split.amber
  const counts = useMemo(() => {
    const c: Split = { red: 0, amber: 0, green: 0, pending: 0 }
    for (const w of writes) c[v(w.verdict)]++
    return c
  }, [writes])

  // context id -> verdicts of the writes it was blamed for (non-green only matter visually)
  const influence = useMemo(() => {
    const m = new Map<string, Verdict[]>()
    for (const w of writes) {
      if (!w.verdict) continue
      const seen = new Set<string>()
      for (const a of w.attributions) {
        if (a.verdict === 'green' || seen.has(a.context_id)) continue
        seen.add(a.context_id)
        m.set(a.context_id, [...(m.get(a.context_id) ?? []), a.verdict])
      }
    }
    return m
  }, [writes])

  const highlighted = useMemo(() => {
    const m = new Map<string, Verdict>()
    for (const a of selected?.attributions ?? []) {
      const prev = m.get(a.context_id)
      if (!prev || RANK[a.verdict] > RANK[prev]) m.set(a.context_id, a.verdict)
    }
    return m
  }, [selected])

  const visibleWrites = untrustedOnly ? writes.filter(isInfluenced) : writes
  const visibleContexts = untrustedOnly ? contexts.filter((c) => c.trust !== 'trusted') : contexts

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: (TimelineItem & { ts: number; o: number })[] = [
      ...visibleContexts.map((c, i) => ({ kind: 'ctx' as const, ctx: c, ts: c.ts, o: i })),
      ...visibleWrites.map((w, i) => ({ kind: 'write' as const, write: w, ts: w.ts, o: 10_000 + i })),
    ]
    return items.sort((a, b) => a.ts - b.ts || a.o - b.o)
  }, [visibleContexts, visibleWrites])

  // Group writes by file, files ordered by worst verdict then first edit.
  const files = useMemo(() => {
    const m = new Map<string, WriteEvent[]>()
    for (const w of visibleWrites) m.set(w.file_path, [...(m.get(w.file_path) ?? []), w])
    return [...m.entries()]
      .map(([path, ws]) => ({
        path,
        writes: ws,
        worst: ws.reduce<VerdictOrPending>((acc, w) => (RANK[v(w.verdict)] > RANK[acc] ? v(w.verdict) : acc), 'green'),
      }))
      .sort((a, b) => RANK[b.worst] - RANK[a.worst] || a.writes[0].ts - b.writes[0].ts)
  }, [visibleWrites])

  const selectWrite = useCallback((id: string) => {
    setSelectedId(id)
    const el = document.getElementById(`w-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
    }
  }, [])
  const close = useCallback(() => setSelectedId(null), [])

  // Deselect if the filter hides the selected write.
  useEffect(() => {
    if (selectedId && !visibleWrites.some((w) => w.id === selectedId)) setSelectedId(null)
  }, [visibleWrites, selectedId])

  const p = pct(influenced, total)
  const allPending = total > 0 && split.pending === total
  const headline = split.red > 0 ? verdictVar.red : split.amber > 0 ? verdictVar.amber : allPending ? verdictVar.pending : verdictVar.green

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* App bar */}
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex items-center gap-4 px-5 py-3">
          <Logo />
          <span className="text-faint">/</span>
          <Link to="/" className="text-sm text-muted no-underline hover:text-fg">
            sessions
          </Link>
          <span className="text-faint">/</span>
          <span className="font-mono text-sm font-medium text-fg">{repoName(session.cwd)}</span>
          <AgentBadge agent={session.agent} />
          <span className="hidden font-mono text-xs text-faint lg:inline">{session.id}</span>
          <span className="ml-auto text-xs text-muted">
            started <Time ts={session.started_at} withDate />
          </span>
        </div>
      </header>

      {/* Headline */}
      <section className="shrink-0 border-b border-line bg-panel/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-5xl font-bold tabular-nums leading-none" style={{ color: headline }}>
              {allPending ? '–' : `${p}%`}
            </span>
            <span className="max-w-[15rem] text-sm leading-snug text-muted">
              {allPending
                ? 'attribution pending for every edit in this session'
                : 'of changed lines influenced by untrusted input'}
            </span>
          </div>
          <div className="min-w-[280px] flex-1">
            <SplitBar split={split} height={12} />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
              {(['red', 'amber', 'green', 'pending'] as const).map((k) =>
                k === 'pending' && counts.pending === 0 ? null : (
                  <span key={k} className="flex items-center gap-1.5 text-muted" title={VERDICT_HINT[k]}>
                    <span className="size-2 rounded-sm" style={{ background: verdictVar[k] }} />
                    <span style={{ color: counts[k] ? verdictVar[k] : undefined }}>{VERDICT_LABEL[k]}</span>
                    <span className="tabular-nums text-fg">{counts[k]}</span>
                    <span className="text-faint">edit{counts[k] === 1 ? '' : 's'} · {split[k]} lines</span>
                  </span>
                ),
              )}
            </div>
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm hover:border-faint">
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${untrustedOnly ? 'bg-v-red' : 'bg-line-2'}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-fg transition-all ${untrustedOnly ? 'left-[18px]' : 'left-0.5'}`}
              />
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={untrustedOnly}
              onChange={(e) => setUntrustedOnly(e.target.checked)}
            />
            Untrusted only
          </label>
        </div>
      </section>

      <div className="flex min-h-0 flex-1">
        {/* Timeline */}
        <aside className="scroll-thin w-[360px] shrink-0 overflow-y-auto border-r border-line bg-panel/40">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-2 backdrop-blur">
            <h2 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
              What the agent read
            </h2>
            <span className="font-mono text-[11px] text-faint">
              {visibleContexts.length} input{visibleContexts.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="py-2">
            <Timeline
              items={timeline}
              influence={influence}
              highlighted={highlighted}
              selectedWrite={selectedId}
              onSelectWrite={selectWrite}
            />
          </div>
        </aside>

        {/* Files */}
        <main
          className="scroll-thin min-w-0 flex-1 overflow-y-auto p-5 transition-[padding]"
          style={{ paddingRight: selected ? 540 : undefined }}
        >
          {files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-2 p-10 text-center text-muted">
              {untrustedOnly ? 'No edits influenced by untrusted input.' : 'No edits in this session yet.'}
            </div>
          ) : (
            <div className="space-y-5">
              {files.map((f) => (
                <FileCard
                  key={f.path}
                  path={f.path}
                  worst={f.worst}
                  writes={f.writes}
                  ctxMap={ctxMap}
                  selectedId={selectedId}
                  onSelect={selectWrite}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {selected && <DetailPanel write={selected} contexts={ctxMap} onClose={close} />}
    </div>
  )
}

function FileCard({
  path,
  worst,
  writes,
  ctxMap,
  selectedId,
  onSelect,
}: {
  path: string
  worst: VerdictOrPending
  writes: WriteEvent[]
  ctxMap: Map<string, ContextEvent>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const name = path.slice(dir.length)
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-2.5">
        <span className="size-2.5 rounded-full" style={{ background: verdictVar[worst] }} />
        <span className="min-w-0 truncate font-mono text-[13px]">
          <span className="text-muted">{dir}</span>
          <span className="font-semibold text-fg">{name}</span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-faint">
          {writes.length} edit{writes.length === 1 ? '' : 's'}
        </span>
      </header>
      {writes.map((w) => (
        <Hunk key={w.id} write={w} contexts={ctxMap} selected={selectedId === w.id} onSelect={() => onSelect(w.id)} />
      ))}
    </section>
  )
}
