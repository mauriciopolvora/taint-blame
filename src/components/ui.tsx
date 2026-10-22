import { useEffect, useState } from 'react'
import { VERDICT_HINT, VERDICT_LABEL, type VerdictOrPending } from './explain'
import type { LiveState } from './live'

export const verdictVar: Record<VerdictOrPending, string> = {
  red: 'var(--color-v-red)',
  amber: 'var(--color-v-amber)',
  green: 'var(--color-v-green)',
  pending: 'var(--color-v-pending)',
}

// Verdict as a word, colored. No pill, no fill: the color is the signal.
export function VerdictChip({ verdict, size = 'md' }: { verdict: VerdictOrPending; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-[13.5px]' : 'text-[12.5px]'
  return (
    <span
      title={VERDICT_HINT[verdict]}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium ${sz}`}
      style={{ color: verdictVar[verdict] }}
    >
      <VerdictDot verdict={verdict} />
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

export function VerdictDot({ verdict, className = '' }: { verdict: VerdictOrPending; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-[7px] shrink-0 rounded-[2px] ${className}`}
      style={{ background: verdictVar[verdict] }}
    />
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
    <a href="/" className="flex items-center gap-2 rounded text-fg no-underline">
      <span aria-hidden className="grid size-[18px] place-items-center rounded-[4px] bg-fg">
        <span className="size-[6px] rounded-[1px] bg-bg" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.015em]">Taint Blame</span>
    </a>
  )
}

const LIVE_TEXT: Record<LiveState, string> = { live: 'Live', paused: 'Paused', offline: 'Reconnecting' }

export function LiveBadge({ state }: { state: LiveState }) {
  const c = state === 'live' ? 'var(--color-v-green)' : state === 'offline' ? 'var(--color-v-amber)' : 'var(--color-faint)'
  return (
    <span
      className="inline-flex items-center gap-2 text-[13px] text-faint"
      title={state === 'live' ? 'Updates every few seconds while this tab is open' : 'Updates resume when you return to this tab'}
      aria-live="polite"
    >
      <span className={`size-1.5 rounded-full ${state === 'live' ? 'live-dot' : ''}`} style={{ background: c }} />
      {LIVE_TEXT[state]}
    </span>
  )
}

export function Header({
  live,
  children,
  width = 'max-w-[1440px]',
}: { live: LiveState; children?: React.ReactNode; width?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className={`mx-auto flex h-14 items-center gap-4 px-6 ${width}`}>
        <Logo />
        {children}
        <div className="ml-auto">
          <LiveBadge state={live} />
        </div>
      </div>
    </header>
  )
}

// Three definitions in a row, separated by hairlines. Only the label carries color.
export function Legend({ className = '' }: { className?: string }) {
  const items: VerdictOrPending[] = ['red', 'amber', 'green']
  return (
    <dl className={`m-0 grid border-t border-line sm:grid-cols-3 ${className}`}>
      {items.map((k, i) => (
        <div key={k} className={`py-5 sm:pr-8 ${i > 0 ? 'border-t border-line sm:border-t-0 sm:border-l sm:pl-8' : ''}`}>
          <dt className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: k === 'red' ? verdictVar.red : 'var(--color-fg)' }}>
            <VerdictDot verdict={k} />
            {VERDICT_LABEL[k]}
          </dt>
          <dd className="m-0 mt-1.5 text-[14.5px] leading-snug text-muted text-pretty">{VERDICT_HINT[k]}.</dd>
        </div>
      ))}
    </dl>
  )
}
