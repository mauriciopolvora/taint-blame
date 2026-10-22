import { useEffect, useState } from 'react'
import type { Trust, Verdict } from '#/server/queries'

export type VerdictOrPending = Verdict | 'pending'

export const VERDICT_LABEL: Record<VerdictOrPending, string> = {
  red: 'Injected',
  amber: 'Copied',
  green: 'Prompted',
  pending: 'Pending',
}

export const VERDICT_HINT: Record<VerdictOrPending, string> = {
  red: 'Carries out an instruction from untrusted content the user never asked for',
  amber: 'Copied or adapted from outside content; looks benign',
  green: 'Explained by the user prompt',
  pending: 'Attribution has not run yet',
}

export const verdictVar: Record<VerdictOrPending, string> = {
  red: 'var(--color-v-red)',
  amber: 'var(--color-v-amber)',
  green: 'var(--color-v-green)',
  pending: 'var(--color-v-pending)',
}

export const trustVar: Record<Trust, string> = {
  trusted: 'var(--color-t-trusted)',
  semi: 'var(--color-t-semi)',
  untrusted: 'var(--color-t-untrusted)',
}

export function v(verdict: string | null | undefined): VerdictOrPending {
  return verdict === 'red' || verdict === 'amber' || verdict === 'green' ? verdict : 'pending'
}

export function VerdictChip({ verdict, size = 'sm' }: { verdict: VerdictOrPending; size?: 'sm' | 'md' }) {
  const c = verdictVar[verdict]
  return (
    <span
      title={VERDICT_HINT[verdict]}
      className={`inline-flex items-center gap-1.5 rounded font-mono font-semibold uppercase tracking-wide ${
        size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-[10px]'
      }`}
      style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} 35%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

export function TrustChip({ trust }: { trust: Trust }) {
  const c = trustVar[trust] ?? 'var(--color-muted)'
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: c, background: `color-mix(in oklab, ${c} 13%, transparent)` }}
    >
      {trust}
    </span>
  )
}

const AGENT_STYLE: Record<string, string> = {
  'claude-code': '#d97757',
  pi: '#7aa2f7',
}

export function AgentBadge({ agent }: { agent: string }) {
  const c = AGENT_STYLE[agent] ?? '#8b96a5'
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-xs font-medium"
      style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} 30%, transparent)` }}
    >
      <span className="size-1.5 rounded-sm" style={{ background: c }} />
      {agent}
    </span>
  )
}

export type Split = Record<VerdictOrPending, number>

export function SplitBar({ split, height = 8, className = '' }: { split: Split; height?: number; className?: string }) {
  const total = split.red + split.amber + split.green + split.pending
  const order: VerdictOrPending[] = ['red', 'amber', 'green', 'pending']
  return (
    <div className={`flex w-full gap-px overflow-hidden rounded-full bg-line ${className}`} style={{ height }}>
      {total > 0 &&
        order.map((k) =>
          split[k] > 0 ? (
            <div
              key={k}
              title={`${VERDICT_LABEL[k]}: ${split[k]} lines`}
              style={{ width: `${(split[k] / total) * 100}%`, background: verdictVar[k] }}
            />
          ) : null,
        )}
    </div>
  )
}

export function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100)
}

export function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

function fmt(ms: number, local: boolean, withDate: boolean): string {
  const d = new Date(ms)
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: withDate ? undefined : '2-digit',
    hour12: false,
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    ...(local ? {} : { timeZone: 'UTC' }),
  }
  return d.toLocaleString('en-US', opts) + (local ? '' : ' UTC')
}

// Renders UTC on the server, local time after hydration (avoids mismatch).
let hydrated = false

export function Time({ ts, withDate = false, className = '' }: { ts: number; withDate?: boolean; className?: string }) {
  const ms = toMs(ts)
  const [local, setLocal] = useState(hydrated)
  useEffect(() => {
    hydrated = true
    setLocal(true)
  }, [])
  return (
    <time dateTime={new Date(ms).toISOString()} className={className}>
      {fmt(ms, local, withDate)}
    </time>
  )
}

export function repoName(cwd: string | null): string {
  if (!cwd) return 'unknown'
  const parts = cwd.replace(/\/+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

export function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5 text-fg no-underline">
      <span className="flex h-6 items-stretch gap-[3px]" aria-hidden>
        <span className="w-[5px] rounded-sm bg-v-green" />
        <span className="w-[5px] rounded-sm bg-v-amber" />
        <span className="w-[5px] rounded-sm bg-v-red" />
      </span>
      <span className="font-mono text-[15px] font-semibold tracking-tight">taint blame</span>
    </a>
  )
}
