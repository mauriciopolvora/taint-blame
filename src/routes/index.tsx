import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { basename } from '#/components/explain'
import { useArrivals, useLiveRefresh } from '#/components/live'
import { AgentName, Ago, Header, Legend, repoName, verdictVar } from '#/components/ui'
import { type SessionSummary, listSessions } from '#/server/queries'

export const Route = createFileRoute('/')({
  loader: () => listSessions(),
  component: Home,
})

function Home() {
  const sessions = Route.useLoaderData()
  const live = useLiveRefresh()
  const isFresh = useArrivals(sessions.map((s) => s.id))

  return (
    <div className="min-h-screen">
      <Header live={live.state} />

      <main className="mx-auto max-w-[1440px] px-6 pt-10 pb-24">
        <section className="max-w-4xl">
          <h1 className="m-0 text-[34px] font-bold leading-tight tracking-tight text-balance md:text-[40px]">
            Git blame for code your AI agent wrote
          </h1>
          <p className="m-0 mt-3 max-w-[60ch] text-xl leading-snug text-muted text-pretty">
            Scanners try to block prompt injection. We assume it gets through and show you exactly which lines it
            wrote.
          </p>
        </section>
        <Legend className="mt-8 max-w-5xl" />

        <h2 className="m-0 mt-12 mb-4 text-xl font-semibold">
          Sessions <span className="font-normal text-muted tabular-nums">{sessions.length || ''}</span>
        </h2>
        {sessions.length === 0 ? <EmptyState /> : <SessionTable sessions={sessions} isFresh={isFresh} />}
      </main>
    </div>
  )
}

function SessionTable({ sessions, isFresh }: { sessions: SessionSummary[]; isFresh: (id: string) => boolean }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            <th className="px-5 py-3 font-medium">Session</th>
            <th className="w-36 px-4 py-3 text-right font-medium">Injected</th>
            <th className="w-32 px-4 py-3 text-right font-medium">Borrowed</th>
            <th className="w-36 px-4 py-3 text-right font-medium">Your request</th>
            <th className="w-40 px-5 py-3 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const go = () => navigate({ to: '/sessions/$id', params: { id: s.id } })
            return (
              <tr
                key={s.id}
                onClick={go}
                className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-panel-2 ${isFresh(s.id) ? 'enter' : ''}`}
                style={s.red ? { boxShadow: `inset 4px 0 0 ${verdictVar.red}` } : undefined}
              >
                <td className="px-5 py-4">
                  <a
                    href={`/sessions/${encodeURIComponent(s.id)}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                      e.preventDefault()
                      go()
                    }}
                    className="rounded text-lg font-semibold text-fg no-underline hover:underline"
                  >
                    {repoName(s.cwd)}
                  </a>
                  <div className="mt-0.5 text-[15px] text-muted">
                    <AgentName agent={s.agent} /> · {s.writes} edit{s.writes === 1 ? '' : 's'} · read {s.inputs} input
                    {s.inputs === 1 ? '' : 's'}
                    {s.untrusted_inputs > 0 && <span className="text-outside">, {s.untrusted_inputs} from outside</span>}
                    {s.pending > 0 && <span> · {s.pending} still being checked</span>}
                  </div>
                  {s.red_files.length > 0 && (
                    <div className="mt-1 text-[15px] font-medium text-v-red">
                      Injected code in {s.red_files.map(basename).join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-4 text-right">
                  {s.red > 0 ? (
                    <span className="text-3xl font-bold tabular-nums text-v-red">{s.red}</span>
                  ) : (
                    <span className="text-lg text-faint">None</span>
                  )}
                </td>
                <td className="px-4 py-4 text-right">
                  <Num n={s.amber} color={verdictVar.amber} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Num n={s.green} color={verdictVar.green} />
                </td>
                <td className="px-5 py-4 text-right text-[15px] whitespace-nowrap text-muted">
                  <Ago ts={s.last_activity} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Num({ n, color }: { n: number; color: string }) {
  return (
    <span className="text-2xl font-semibold tabular-nums" style={{ color: n ? color : 'var(--color-faint)' }}>
      {n}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line-2 p-8 md:p-10">
      <p className="m-0 text-xl font-semibold">No sessions yet</p>
      <p className="m-0 mt-2 max-w-[65ch] text-[17px] text-muted">
        Connect a coding agent and run it. Every file it reads and every edit it makes shows up here within a few
        seconds. This page updates on its own.
      </p>
      <ol className="m-0 mt-6 grid list-none gap-4 p-0 md:grid-cols-2">
        <li className="rounded-lg bg-panel p-5">
          <p className="m-0 font-semibold">Claude Code</p>
          <p className="m-0 mt-1 text-[15px] text-muted">Install the hook into the repo you want to watch:</p>
          <pre className="code m-0 mt-3 overflow-x-auto rounded-md bg-code p-3">
            node adapters/claude-code/install.mjs /path/to/repo
          </pre>
        </li>
        <li className="rounded-lg bg-panel p-5">
          <p className="m-0 font-semibold">pi</p>
          <p className="m-0 mt-1 text-[15px] text-muted">Load the extension when you start pi:</p>
          <pre className="code m-0 mt-3 overflow-x-auto rounded-md bg-code p-3">pi -e adapters/pi/taint-blame.ts</pre>
        </li>
      </ol>
      <p className="m-0 mt-4 text-[15px] text-muted">
        Both read <code className="code text-fg">TAINT_BLAME_URL</code> and <code className="code text-fg">TAINT_BLAME_TOKEN</code>{' '}
        from <code className="code text-fg">~/.taint-blame/config.env</code>. Already have a transcript? Replay it with{' '}
        <code className="code text-fg">node adapters/import.mjs &lt;file.jsonl&gt;</code>.
      </p>
    </div>
  )
}
