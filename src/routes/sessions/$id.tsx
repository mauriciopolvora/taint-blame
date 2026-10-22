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

const SECTION: Record<VerdictOrPending, { title: string; sub?: string }> = {
  red: { title: 'Injected', sub: 'did something you never asked for' },
  amber: { title: 'Borrowed', sub: 'copied from outside, but serves your request' },
  pending: { title: 'Still being checked' },
  green: { title: 'Your request', sub: 'explained by your request and repo alone' },
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
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[14px]">
          <span className="text-line-2" aria-hidden>
            /
          </span>
          <Link to="/" className="rounded text-muted no-underline hover:text-fg">
            Sessions
          </Link>
          <span className="text-line-2" aria-hidden>
            /
          </span>
          <span className="truncate font-medium text-fg">{repoName(session.cwd)}</span>
        </nav>
      </Header>

      <main className="mx-auto max-w-[1440px] px-6 pt-10 pb-24">
        <Summary
          tone={tone}
          lines={summary}
          groups={groups}
          contexts={contexts}
          agent={session.agent}
          cwd={session.cwd}
          startedAt={session.started_at}
        />

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-12">
            {writes.length === 0 && (
              <div className="rounded-lg border border-dashed border-line-2 p-10 text-center text-[15px] text-muted">
                No edits yet. They will appear here as the agent works.
              </div>
            )}
            {(['red', 'amber', 'pending'] as const).map((k) =>
              groups[k].length ? (
                <section key={k} aria-labelledby={`sec-${k}`}>
                  <SectionTitle id={`sec-${k}`} verdict={k} count={groups[k].length} />
                  <div className="space-y-4">
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
  const sec = SECTION[verdict]
  return (
    <h2 id={id} className="m-0 mb-4 flex items-baseline gap-2 text-[15px] font-semibold">
      <span style={{ color: verdict === 'red' ? verdictVar.red : 'var(--color-fg)' }}>{sec.title}</span>
      <span className="font-normal text-faint tabular-nums">{count}</span>
      {sec.sub && <span className="font-normal text-muted">· {sec.sub}</span>}
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
    <details className="group border-t border-line">
      <summary className="flex min-h-12 cursor-pointer select-none flex-wrap items-baseline gap-x-2 gap-y-1 py-4 text-[15px] hover:text-fg">
        <span aria-hidden className="inline-block w-3 text-faint transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        <span className="font-semibold text-fg">{SECTION.green.title}</span>
        <span className="text-faint tabular-nums">{writes.length}</span>
        <span className="min-w-0 flex-1 truncate text-muted">
          · {SECTION.green.sub} · <span className="font-mono text-[13px]">{files.join(', ')}</span>
        </span>
        <span className="text-[13px] text-faint group-open:hidden">Show</span>
        <span className="hidden text-[13px] text-faint group-open:inline">Hide</span>
      </summary>
      <div className="space-y-4 pb-2">
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
  const outside = contexts.filter((x) => x.trust === 'untrusted').length
  const [first, ...rest] = lines
  return (
    <section aria-label="Summary">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
        <span className="font-medium text-fg">{repoName(cwd)}</span>
        <span className="text-faint">·</span>
        <AgentName agent={agent} />
        <span className="text-faint">·</span>
        <span>
          started <Ago ts={startedAt} />
        </span>
      </div>
      <p className="m-0 mt-4 max-w-[34ch] text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-balance md:text-[36px]">
        {first}
      </p>
      {rest.map((l, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: sentences are positional
          key={i}
          className="m-0 mt-3 max-w-[64ch] text-[18px] leading-relaxed text-pretty"
          style={{ color: i === 0 && tone === 'red' ? verdictVar.red : 'var(--color-muted)' }}
        >
          {l}
        </p>
      ))}

      <dl className="m-0 mt-10 grid grid-cols-2 border-y border-line sm:grid-cols-4">
        <Stat verdict="red" n={groups.red.length} />
        <Stat verdict="amber" n={groups.amber.length} />
        <Stat verdict="green" n={groups.green.length} />
        <div className="border-line py-4 sm:border-l sm:pl-6">
          <dt className="text-[13.5px] text-muted">Inputs read</dt>
          <dd className="m-0 mt-1 flex items-baseline gap-2">
            <span className="text-[32px] font-semibold tracking-[-0.02em] tabular-nums">{contexts.length}</span>
            {outside > 0 && <span className="text-[13.5px] text-muted">{outside} from outside</span>}
          </dd>
        </div>
      </dl>
      {groups.pending.length > 0 && (
        <p className="m-0 mt-3 text-[14px] text-muted">{groups.pending.length} more still being checked.</p>
      )}
    </section>
  )
}

function Stat({ verdict, n }: { verdict: VerdictOrPending; n: number }) {
  const hot = verdict === 'red' && n > 0
  return (
    <div className={`border-line py-4 ${verdict === 'red' ? '' : 'border-l pl-6'}`} title={VERDICT_HINT[verdict]}>
      <dt>
        <VerdictChip verdict={verdict} size="md" />
      </dt>
      <dd className="m-0 mt-1 flex items-baseline gap-2">
        <span
          className="text-[32px] font-semibold tracking-[-0.02em] tabular-nums"
          style={{ color: hot ? verdictVar.red : n ? 'var(--color-fg)' : 'var(--color-faint)' }}
        >
          {n}
        </span>
        <span className="text-[13.5px] text-muted">edit{n === 1 ? '' : 's'}</span>
      </dd>
    </div>
  )
}
