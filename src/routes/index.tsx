import { Link, createFileRoute } from '@tanstack/react-router'
import { basename } from '#/components/explain'
import { useArrivals, useLiveRefresh } from '#/components/live'
import { AgentName, Ago, Header, Legend, repoName } from '#/components/ui'
import { type SessionSummary, listSessions } from '#/server/queries'

export const Route = createFileRoute('/')({
  loader: () => listSessions(),
  component: Home,
})

const WIDTH = 'max-w-[1200px]'

function Home() {
  const sessions = Route.useLoaderData()
  const live = useLiveRefresh()
  const isFresh = useArrivals(sessions.map((s) => s.id))
  const injected = sessions.filter((s) => s.red > 0).length

  return (
    <div className="min-h-screen">
      <Header live={live.state} width={WIDTH} />

      <main className={`mx-auto px-6 pb-32 ${WIDTH}`}>
        <section className="pt-16 pb-12 md:pt-20">
          <p className="label m-0">Prompt-injection forensics for coding agents</p>
          <h1 className="m-0 mt-4 max-w-[20ch] text-[40px] leading-[1.08] font-semibold tracking-[-0.032em] text-balance md:text-[52px]">
            Git blame for code your AI agent wrote.
          </h1>
          <p className="m-0 mt-5 max-w-[52ch] text-[18px] leading-relaxed text-muted text-pretty">
            Scanners try to block prompt injection. We assume it gets through and show you{' '}
            <span className="font-medium text-fg">exactly which lines it wrote.</span>
          </p>
        </section>

        <Legend />

        <section aria-labelledby="sessions" className="mt-16">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 id="sessions" className="m-0 text-[15px] font-semibold text-fg">
              Sessions
            </h2>
            {sessions.length > 0 && <span className="text-sm text-faint tabular-nums">{sessions.length}</span>}
            {injected > 0 && (
              <span className="ml-auto text-sm font-medium text-v-red tabular-nums">
                {injected} with injected code
              </span>
            )}
          </div>
          {sessions.length === 0 ? <EmptyState /> : <SessionList sessions={sessions} isFresh={isFresh} />}
        </section>
      </main>
    </div>
  )
}

const COLS = 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_72px_132px_104px]'

function SessionList({ sessions, isFresh }: { sessions: SessionSummary[]; isFresh: (id: string) => boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className={`hidden h-9 items-center gap-4 border-b border-line px-5 md:grid ${COLS}`}>
        <span className="label">Repository</span>
        <span className="label">Finding</span>
        <span className="label text-right">Edits</span>
        <span className="label text-right">Inputs read</span>
        <span className="label text-right">Last activity</span>
      </div>
      <ul className="m-0 list-none p-0">
        {sessions.map((s) => (
          <li key={s.id} className={`border-b border-line last:border-b-0 ${isFresh(s.id) ? 'enter' : ''}`}>
            <Row s={s} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ s }: { s: SessionSummary }) {
  const hot = s.red > 0
  return (
    <Link
      to="/sessions/$id"
      params={{ id: s.id }}
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 text-fg no-underline transition-colors duration-150 hover:bg-panel-2 md:min-h-14 ${COLS}`}
      style={hot ? { background: 'color-mix(in oklab, var(--color-v-red) 3.5%, var(--color-panel))' } : undefined}
    >
      {hot && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-v-red" />}

      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="truncate text-[15px] font-medium tracking-[-0.01em]">{repoName(s.cwd)}</span>
        <span className="shrink-0 text-[13px]">
          <AgentName agent={s.agent} />
        </span>
      </div>

      <div className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
        <Finding s={s} />
      </div>

      <div className="hidden text-right text-sm tabular-nums md:block">{s.writes ? s.writes : <Dash />}</div>

      <div className="hidden text-right text-sm tabular-nums md:block">
        {s.inputs > 0 ? (
          <>
            <span className="text-fg">{s.inputs}</span>
            {s.untrusted_inputs > 0 && <span className="text-faint"> · {s.untrusted_inputs} outside</span>}
          </>
        ) : (
          <Dash />
        )}
      </div>

      <div className="col-start-2 row-start-1 text-right text-[13px] whitespace-nowrap text-faint md:col-start-auto md:row-start-auto">
        <Ago ts={s.last_activity} />
      </div>
    </Link>
  )
}

function Finding({ s }: { s: SessionSummary }) {
  if (s.red > 0) {
    const files = s.red_files.map(basename)
    return (
      <div className="flex min-w-0 items-baseline gap-2 text-sm">
        <span className="shrink-0 font-semibold tabular-nums text-v-red">{s.red} injected</span>
        <span className="truncate text-fg">
          <span className="text-faint">in </span>
          <span className="font-mono text-[13px]">{files.join(', ')}</span>
        </span>
      </div>
    )
  }
  if (s.amber > 0) {
    return (
      <span className="text-sm text-muted">
        <span className="font-medium text-fg tabular-nums">{s.amber} borrowed</span> from outside, nothing injected
      </span>
    )
  }
  if (s.green > 0) {
    return <span className="text-sm text-muted">Every edit traces to your request</span>
  }
  if (s.pending > 0) {
    return (
      <span className="text-sm text-faint">
        Checking {s.pending} edit{s.pending === 1 ? '' : 's'}…
      </span>
    )
  }
  return <span className="text-sm text-faint">No edits yet</span>
}

function Dash() {
  return <span className="text-sm text-faint">–</span>
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-line bg-panel px-6 py-14 md:px-12">
      <div className="mx-auto max-w-[640px] text-center">
        <span className="inline-flex items-center gap-2 text-[13px] text-muted">
          <span className="live-dot size-1.5 rounded-full bg-v-green" />
          Waiting for the first session
        </span>
        <p className="m-0 mt-4 text-[22px] font-semibold tracking-[-0.02em]">Connect a coding agent</p>
        <p className="m-0 mt-2 text-[15px] text-muted text-pretty">
          Every file it reads and every edit it makes shows up here within seconds. This page updates on its own.
        </p>
      </div>
      <ul className="mx-auto mt-10 grid max-w-[1000px] list-none gap-px overflow-hidden rounded-md border border-line bg-line p-0 md:grid-cols-2">
        <Step
          title="Claude Code"
          hint="Install the hook into the repo you want to watch"
          cmd="node adapters/claude-code/install.mjs /path/to/repo"
        />
        <Step title="pi" hint="Load the extension when you start pi" cmd="pi -e adapters/pi/taint-blame.ts" />
      </ul>
      <p className="mx-auto m-0 mt-6 max-w-[1000px] text-center text-[13px] leading-relaxed text-faint">
        Both read <code className="code whitespace-nowrap text-muted">TAINT_BLAME_URL</code> and{' '}
        <code className="code whitespace-nowrap text-muted">TAINT_BLAME_TOKEN</code> from{' '}
        <code className="code whitespace-nowrap text-muted">~/.taint-blame/config.env</code>. Replay an existing transcript with{' '}
        <code className="code whitespace-nowrap text-muted">node adapters/import.mjs &lt;file.jsonl&gt;</code>.
      </p>
    </div>
  )
}

function Step({ title, hint, cmd }: { title: string; hint: string; cmd: string }) {
  return (
    <li className="bg-panel p-5">
      <p className="m-0 text-sm font-medium">{title}</p>
      <p className="m-0 mt-1.5 text-[13px] text-muted">{hint}</p>
      <pre className="code scroll-thin m-0 mt-3 overflow-x-auto rounded-md border border-line bg-code px-3 py-2 text-[12.5px] text-fg">
        {cmd}
      </pre>
    </li>
  )
}
