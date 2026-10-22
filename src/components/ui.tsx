import { useEffect, useState } from 'react'
import { VERDICT_HINT, VERDICT_LABEL, type VerdictOrPending } from './explain'
import type { LiveState } from './live'

export const verdictVar: Record<VerdictOrPending, string> = {
  red: 'var(--color-v-red)',
  amber: 'var(--color-v-amber)',
  green: 'var(--color-v-green)',
  pending: 'var(--color-v-pending)',
}

const VERDICT_ICON: Record<VerdictOrPending, string> = { red: '!', amber: '↳', green: '✓', pending: '…' }

export function VerdictChip({ verdict, size = 'md' }: { verdict: VerdictOrPending; size?: 'sm' | 'md' | 'lg' }) {
  const c = verdictVar[verdict]
  const sz = size === 'lg' ? 'h-8 px-3 text-sm' : size === 'md' ? 'h-7 px-2.5 text-[13px]' : 'h-6 px-2 text-xs'
  return (
    <span
      title={VERDICT_HINT[verdict]}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${sz}`}
      style={{ color: c, background: `color-mix(in oklab, ${c} 16%, transparent)` }}
    >
      <span
        aria-hidden
        className="flex size-4 items-center justify-center rounded-full text-[11px] font-bold leading-none text-bg"
        style={{ background: c }}
      >
        {VERDICT_ICON[verdict]}
      </span>
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

const AGENT_NAME: Record<string, string> = { 'claude-code': 'Claude Code', pi: 'pi' }

export function AgentName({ agent }: { agent: string }) {
  return <span className="whitespace-nowrap text-muted">{AGENT_NAME[agent] ?? agent}</span>
}

export function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

let hydrated = false
function useHydrated() {
  const [h, setH] = useState(hydrated)
  useEffect(() => {
    hydrated = true
    setH(true)
  }, [])
  return h
}

function clock(ms: number, local: boolean, withDate: boolean) {
  return (
    new Date(ms).toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: withDate ? undefined : '2-digit',
      hour12: false,
      ...(withDate ? { month: 'short', day: 'numeric' } : {}),
      ...(local ? {} : { timeZone: 'UTC' }),
    }) + (local ? '' : ' UTC')
  )
}

// Server renders UTC, the client switches to local time after hydration.
export function Time({ ts, withDate = false, className = '' }: { ts: number; withDate?: boolean; className?: string }) {
  const ms = toMs(ts)
  const local = useHydrated()
  return (
    <time dateTime={new Date(ms).toISOString()} className={`tabular-nums ${className}`}>
      {clock(ms, local, withDate)}
    </time>
  )
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

// "5 min ago" once hydrated; absolute time on the server.
export function Ago({ ts, className = '' }: { ts: number; className?: string }) {
  const ms = toMs(ts)
  const local = useHydrated()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return (
    <time dateTime={new Date(ms).toISOString()} title={clock(ms, local, true)} className={className}>
      {local ? ago(ms, now) : clock(ms, false, true)}
    </time>
  )
}

export function repoName(cwd: string | null): string {
  if (!cwd) return 'unknown repo'
  const parts = cwd.replace(/\/+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

export function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5 rounded-md text-fg no-underline">
      <span className="flex h-6 items-stretch gap-[3px]" aria-hidden>
        <span className="w-[5px] rounded-sm bg-v-green" />
        <span className="w-[5px] rounded-sm bg-v-amber" />
        <span className="w-[5px] rounded-sm bg-v-red" />
      </span>
      <span className="text-lg font-semibold tracking-tight">Taint Blame</span>
    </a>
  )
}

const LIVE_TEXT: Record<LiveState, string> = { live: 'Live', paused: 'Paused', offline: 'Reconnecting' }

export function LiveBadge({ state }: { state: LiveState }) {
  const c = state === 'live' ? 'var(--color-v-green)' : state === 'offline' ? 'var(--color-v-amber)' : 'var(--color-muted)'
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3 py-1 text-sm text-muted"
      title={state === 'live' ? 'Updates every few seconds while this tab is open' : 'Updates resume when you return to this tab'}
      aria-live="polite"
    >
      <span className={`relative flex size-2.5 ${state === 'live' ? 'live-dot' : ''}`} style={{ color: c }}>
        <span className="size-2.5 rounded-full" style={{ background: c }} />
      </span>
      {LIVE_TEXT[state]}
    </span>
  )
}

export function Header({ live, children }: { live: LiveState; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-6">
        <Logo />
        {children}
        <div className="ml-auto">
          <LiveBadge state={live} />
        </div>
      </div>
    </header>
  )
}

export function Legend({ className = '' }: { className?: string }) {
  const items: VerdictOrPending[] = ['red', 'amber', 'green']
  return (
    <dl className={`grid gap-4 sm:grid-cols-3 ${className}`}>
      {items.map((k) => (
        <div key={k} className="flex items-start gap-3">
          <dt>
            <VerdictChip verdict={k} />
          </dt>
          <dd className="m-0 pt-0.5 text-[15px] leading-snug text-muted">{VERDICT_HINT[k]}.</dd>
        </div>
      ))}
    </dl>
  )
}
