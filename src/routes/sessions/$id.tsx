import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { useMemo } from 'react'
import { EditCard } from '#/components/EditCard'
import { InputTimeline } from '#/components/InputTimeline'
import { VERDICT_HINT, type VerdictOrPending, sessionSummary, v } from '#/components/explain'
import { useArrivals, useLiveRefresh } from '#/components/live'
import { AgentName, Ago, Header, VerdictChip, repoName, verdictVar } from '#/components/ui'
import { type ContextEvent, type WriteEvent, getSession } from '#/server/queries'

export const Route = createFileRoute('/sessions/$id')({
  loader: async ({ params }) => {
    const data = await getSession({ data: params.id })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Taint Blame' }] }
    const red = loaderData.writes.filter((w) => w.verdict === 'red').length
    return {
      meta: [{ title: `${red ? `(${red} injected) ` : ''}${repoName(loaderData.session.cwd)} · Taint Blame` }],
    }
  },
  component: SessionPage,
})

const SECTION: Record<VerdictOrPending, { title: string; empty?: string }> = {
  red: { title: 'Injected: did something you never asked for' },
  amber: { title: 'Borrowed: copied from outside, but serves your request' },
  pending: { title: 'Still being checked' },
  green: { title: 'Your request' },
}

function SessionPage() {
  const { session, contexts, writes } = Route.useLoaderData()
  const live = useLiveRefresh()
  const ctxMap = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts])
  const isFresh = useArrivals(useMemo(() => [...contexts.map((c) => c.id), ...writes.map((w) => w.id)], [contexts, writes]))

  const groups = useMemo(() => {
    const g: Record<VerdictOrPending, WriteEvent[]> = { red: [], amber: [], green: [], pending: [] }
    for (const w of writes) g[v(w.verdict)].push(w)
    return g
  }, [writes])

  const summary = useMemo(() => sessionSummary(writes, ctxMap, session.cwd), [writes, ctxMap, session.cwd])
  const tone: VerdictOrPending = groups.red.length
    ? 'red'
    : groups.amber.length
      ? 'amber'
      : groups.pending.length && !groups.green.length
        ? 'pending'
        : 'green'

  return (
    <div className="min-h-screen">
      <Header live={live.state}>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[15px]">
          <span className="text-faint" aria-hidden>
            /
          </span>
          <Link to="/" className="rounded text-muted no-underline hover:text-fg">
            Sessions
          </Link>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="truncate font-medium text-fg">{repoName(session.cwd)}</span>
        </nav>
      </Header>

      <main className="mx-auto max-w-[1440px] px-6 pt-8 pb-24">
        <Summary
          tone={tone}
          lines={summary}
          groups={groups}
          contexts={contexts}
          agent={session.agent}
          cwd={session.cwd}
          startedAt={session.started_at}
        />

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-10">
            {writes.length === 0 && (
              <div className="rounded-xl border border-dashed border-line-2 p-10 text-center text-lg text-muted">
                No edits yet. They will appear here as the agent works.
              </div>
            )}
            {(['red', 'amber', 'pending'] as const).map((k) =>
              groups[k].length ? (
                <section key={k} aria-labelledby={`sec-${k}`}>
                  <SectionTitle id={`sec-${k}`} verdict={k} count={groups[k].length} />
                  <div className="space-y-5">
                    {groups[k].map((w) => (
                      <EditCard key={w.id} write={w} ctx={ctxMap} cwd={session.cwd} fresh={isFresh(w.id)} />
                    ))}
                  </div>
                </section>
              ) : null,
            )}
            {groups.green.length > 0 && (
              <GreenSection writes={groups.green} ctx={ctxMap} cwd={session.cwd} isFresh={isFresh} />
            )}
          </div>

          <aside className="lg:sticky lg:top-24">
            <InputTimeline contexts={contexts} writes={writes} ctxMap={ctxMap} cwd={session.cwd} isFresh={isFresh} />
          </aside>
        </div>
      </main>
    </div>
  )
}

function SectionTitle({ id, verdict, count }: { id: string; verdict: VerdictOrPending; count: number }) {
  return (
    <h2 id={id} className="m-0 mb-4 flex items-center gap-3 text-xl font-semibold" style={{ color: verdictVar[verdict] }}>
      {SECTION[verdict].title}
      <span className="rounded-full bg-panel-2 px-2.5 py-0.5 text-base tabular-nums text-fg">{count}</span>
    </h2>
  )
}

function GreenSection({
  writes,
  ctx,
  cwd,
  isFresh,
}: {
  writes: WriteEvent[]
  ctx: Map<string, ContextEvent>
  cwd: string | null
  isFresh: (id: string) => boolean
}) {
  const files = [...new Set(writes.map((w) => w.file_path.split('/').pop()))]
  return (
    <details className="group rounded-xl border border-line bg-panel">
      <summary className="flex min-h-16 cursor-pointer select-none flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-5 py-4 hover:bg-panel-2">
        <span aria-hidden className="text-xl text-muted transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        <span className="text-xl font-semibold" style={{ color: verdictVar.green }}>
          {SECTION.green.title}
        </span>
        <span className="rounded-full bg-panel-2 px-2.5 py-0.5 text-base tabular-nums">{writes.length}</span>
        <span className="min-w-0 flex-1 truncate text-[15px] text-muted">
          Matches what you asked for · {files.join(', ')}
        </span>
        <span className="text-sm text-muted group-open:hidden">Show</span>
        <span className="hidden text-sm text-muted group-open:inline">Hide</span>
      </summary>
      <div className="space-y-5 px-5 pb-5">
        {writes.map((w) => (
          <EditCard key={w.id} write={w} ctx={ctx} cwd={cwd} fresh={isFresh(w.id)} />
        ))}
      </div>
    </details>
  )
}

function Summary({
  tone,
  lines,
  groups,
  contexts,
  agent,
  cwd,
  startedAt,
}: {
  tone: VerdictOrPending
  lines: string[]
  groups: Record<VerdictOrPending, WriteEvent[]>
  contexts: ContextEvent[]
  agent: string
  cwd: string | null
  startedAt: number
}) {
  const c = verdictVar[tone]
  const outside = contexts.filter((x) => x.trust === 'untrusted').length
  const [first, ...rest] = lines
  return (
    <section
      aria-label="Summary"
      className="rounded-2xl border bg-panel p-6 md:p-8"
      style={{
        borderColor: `color-mix(in oklab, ${c} 45%, var(--color-line))`,
        backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${c} 9%, transparent), transparent 60%)`,
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
        <span className="font-semibold text-fg">{repoName(cwd)}</span>
        <span className="text-faint">·</span>
        <AgentName agent={agent} />
        <span className="text-faint">·</span>
        <span className="text-muted">
          started <Ago ts={startedAt} />
        </span>
      </div>
      <p className="m-0 max-w-[60ch] text-[26px] font-semibold leading-tight text-balance md:text-[30px]">{first}</p>
      {rest.map((l, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: sentences are positional
          key={i}
          className="m-0 mt-2 max-w-[70ch] text-[20px] leading-snug text-pretty md:text-[22px]"
          style={{ color: i === 0 && tone !== 'green' && tone !== 'pending' ? c : 'var(--color-muted)' }}
        >
          {l}
        </p>
      ))}

      <dl className="m-0 mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat verdict="red" n={groups.red.length} />
        <Stat verdict="amber" n={groups.amber.length} />
        <Stat verdict="green" n={groups.green.length} />
        <div className="rounded-xl bg-panel-2 px-4 py-3">
          <dt className="text-[15px] text-muted">Inputs read</dt>
          <dd className="m-0 mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">{contexts.length}</span>
            {outside > 0 && <span className="text-[15px] text-outside">{outside} from outside</span>}
          </dd>
        </div>
      </dl>
      {groups.pending.length > 0 && (
        <p className="m-0 mt-3 text-[15px] text-muted">{groups.pending.length} more still being checked.</p>
      )}
    </section>
  )
}

function Stat({ verdict, n }: { verdict: VerdictOrPending; n: number }) {
  const c = verdictVar[verdict]
  return (
    <div
      className="rounded-xl bg-panel-2 px-4 py-3"
      title={VERDICT_HINT[verdict]}
      style={n && verdict === 'red' ? { boxShadow: `inset 0 0 0 2px ${c}` } : undefined}
    >
      <dt>
        <VerdictChip verdict={verdict} size="sm" />
      </dt>
      <dd className="m-0 mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums" style={{ color: n ? c : 'var(--color-faint)' }}>
          {n}
        </span>
        <span className="text-[15px] text-muted">edit{n === 1 ? '' : 's'}</span>
      </dd>
    </div>
  )
}
