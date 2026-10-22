import { Link, createFileRoute } from '@tanstack/react-router'
import { AgentBadge, Logo, SplitBar, Time, pct, repoName, verdictVar } from '#/components/ui'
import { listSessions } from '#/server/queries'

export const Route = createFileRoute('/')({
  loader: () => listSessions(),
  component: Home,
})

function Count({ n, color }: { n: number; color: string }) {
  return (
    <span className="font-mono text-sm tabular-nums" style={{ color: n > 0 ? color : 'var(--color-faint)' }}>
      {n}
    </span>
  )
}

function Home() {
  const sessions = Route.useLoaderData()

  const totals = sessions.reduce(
    (t, s) => ({
      changed: t.changed + s.changed_lines,
      influenced: t.influenced + s.influenced_lines,
      red: t.red + s.red,
      amber: t.amber + s.amber,
    }),
    { changed: 0, influenced: 0, red: 0, amber: 0 },
  )

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3.5">
          <Logo />
          <span className="hidden text-sm text-muted md:inline">
            Git blame for AI-written code, by what the agent had read.
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Agent sessions</h1>
            <p className="mt-1 mb-0 max-w-2xl text-sm text-muted">
              Scanners try to block prompt injection. We assume it gets through and show you exactly which lines it
              wrote.
            </p>
          </div>
          <div className="flex gap-8 font-mono">
            <Stat label="sessions" value={sessions.length} />
            <Stat label="influenced lines" value={`${pct(totals.influenced, totals.changed)}%`} />
            <Stat label="injected edits" value={totals.red} color={totals.red ? verdictVar.red : undefined} />
            <Stat label="copied edits" value={totals.amber} color={totals.amber ? verdictVar.amber : undefined} />
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-2 p-12 text-center text-muted">
            No sessions yet. Point an adapter at <code className="font-mono text-fg">/api/events</code> and run an
            agent.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Repo</th>
                  <th className="px-4 py-2.5 font-medium">Started</th>
                  <th className="px-4 py-2.5 text-right font-medium">Inputs</th>
                  <th className="px-4 py-2.5 text-right font-medium">Edits</th>
                  <th className="w-[26%] px-4 py-2.5 font-medium">Lines influenced by untrusted input</th>
                  <th className="px-4 py-2.5 text-right font-medium">Injected</th>
                  <th className="px-4 py-2.5 text-right font-medium">Copied</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const allPending = s.writes > 0 && s.pending === s.writes
                  const p = allPending ? '–' : `${pct(s.influenced_lines, s.changed_lines)}%`
                  const pColor = s.red > 0 ? verdictVar.red : s.amber > 0 ? verdictVar.amber : 'var(--color-muted)'
                  return (
                    <tr key={s.id} className="group border-b border-line last:border-b-0 hover:bg-panel-2">
                      <td className="px-4 py-3">
                        <Link to="/sessions/$id" params={{ id: s.id }}>
                          <AgentBadge agent={s.agent} />
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/sessions/$id"
                          params={{ id: s.id }}
                          className="whitespace-nowrap font-mono text-sm font-medium text-fg no-underline group-hover:underline"
                        >
                          {repoName(s.cwd)}
                        </Link>
                        <div className="mt-0.5 font-mono text-[11px] text-faint">{s.id.slice(0, 12)}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted">
                        <Time ts={s.started_at} withDate />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">
                        {s.inputs}
                        {s.untrusted_inputs > 0 && (
                          <span className="ml-1.5 text-[11px] text-t-untrusted">{s.untrusted_inputs} untrusted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">
                        {s.writes}
                        {s.pending > 0 && <span className="ml-1.5 text-[11px] text-v-pending">{s.pending} pending</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="w-11 text-right font-mono text-base font-semibold tabular-nums" style={{ color: pColor }}>
                            {p}
                          </span>
                          <SplitBar
                            className="flex-1"
                            height={6}
                            split={s.lines}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Count n={s.red} color={verdictVar.red} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Count n={s.amber} color={verdictVar.amber} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-right">
      <div className="text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  )
}
