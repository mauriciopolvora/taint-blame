import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { type LiveState } from './live'
import { LiveBadge } from './ui'

// App frame: a sidebar on wide screens, a top bar with a drawer on narrow ones.
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  // Close the drawer whenever the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger
  useEffect(() => setOpen(false), [path])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <div className="sticky top-0 z-30 flex h-13 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          className="press grid size-9 place-items-center rounded-md border border-line bg-panel text-fg"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />}
          </svg>
        </button>
        <Mark />
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-fg/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] border-r border-line bg-panel-2 transition-transform duration-200 ease-[var(--ease-out)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar path={path} />
      </aside>

      <div className="min-w-0">{children}</div>
      <Toaster />
    </div>
  )
}

function Mark() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded text-fg no-underline">
      <span aria-hidden className="grid size-[20px] place-items-center rounded-[5px] bg-fg">
        <span className="size-[7px] rounded-[1.5px] bg-v-red" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.015em]">Taint Blame</span>
    </Link>
  )
}

function Sidebar({ path }: { path: string }) {
  const sessionsActive = path === '/' || path.startsWith('/sessions')
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <div className="flex h-8 items-center">
          <Mark />
        </div>
        <button
          type="button"
          className="mt-4 flex w-full items-center gap-2.5 rounded-md border border-line bg-panel px-2.5 py-2 text-left shadow-[0_1px_0_rgb(20_20_18/0.03)] hover:border-line-2"
          title="Workspaces are coming soon"
        >
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-fg text-[11px] font-semibold text-bg">
            M
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">Mauricio's workspace</span>
            <span className="block text-[12px] text-faint">Personal · Free</span>
          </span>
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-faint">
            <path d="M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5" />
          </svg>
        </button>
      </div>

      <nav aria-label="Main" className="mt-5 px-3">
        <p className="label m-0 px-2 pb-1.5">Workspace</p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          <li>
            <NavItem to="/" active={sessionsActive} label="Sessions" icon={<IconSessions />} />
          </li>
          <li>
            <NavItem to="/settings" active={path === '/settings'} label="Settings" icon={<IconSettings />} />
          </li>
        </ul>
        <p className="label m-0 mt-5 px-2 pb-1.5">Product</p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          <li>
            <NavItem to="/welcome" active={path === '/welcome'} label="About Taint Blame" icon={<IconAbout />} />
          </li>
        </ul>
      </nav>

      <div className="mt-auto space-y-3 p-3">
        <AgentCard />
        <div className="flex items-center gap-2.5 border-t border-line px-1 pt-3">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-panel text-[11px] font-semibold text-muted ring-1 ring-line-2">
            MP
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">mauricio</span>
            <span className="block text-[12px] text-faint">Owner</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function NavItem({ to, active, label, icon }: { to: '/' | '/settings' | '/welcome'; active: boolean; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] no-underline transition-colors duration-150 ${
        active ? 'bg-panel font-medium text-fg shadow-[0_0_0_1px_var(--color-line)]' : 'text-muted hover:bg-panel/70 hover:text-fg'
      }`}
    >
      <span className={active ? 'text-fg' : 'text-faint'}>{icon}</span>
      {label}
    </Link>
  )
}

export function AgentCard() {
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-v-green" aria-hidden />
        <span className="text-[13px] font-medium">Agent: pi</span>
        <span className="ml-auto text-[11.5px] text-faint">extension</span>
      </div>
      <p className="m-0 mt-1 text-[12.5px] leading-snug text-muted">
        Guard via <code className="code text-[12px] text-fg">/taint-blame</code>
      </p>
    </div>
  )
}

function IconSessions() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </svg>
  )
}

function IconAbout() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.25v3.5M8 5.25v.01" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34L3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66L3.6 3.6" />
    </svg>
  )
}

// Title row at the top of every page. `crumbs` replaces the eyebrow with a path.
export function PageHeader({
  title,
  description,
  crumbs,
  live,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  crumbs?: React.ReactNode
  live?: LiveState
  actions?: React.ReactNode
}) {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto max-w-[1280px] px-6 pt-7 pb-6 lg:px-10">
        {crumbs && <nav aria-label="Breadcrumb" className="mb-2 flex min-w-0 items-center gap-2 text-[13.5px]">{crumbs}</nav>}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-[24px] leading-tight font-semibold tracking-[-0.022em]">{title}</h1>
            {description && <p className="m-0 mt-1.5 max-w-[72ch] text-[14.5px] text-muted text-pretty">{description}</p>}
          </div>
          {(live || actions) && (
            <div className="flex items-center gap-4 pt-1">
              {live && <LiveBadge state={live} />}
              {actions}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export const PAGE = 'mx-auto max-w-[1280px] px-6 lg:px-10'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'danger' | 'primary' }

export function Button({ tone = 'default', className = '', ...rest }: ButtonProps) {
  const t =
    tone === 'danger'
      ? 'border-v-red/30 bg-panel text-v-red hover:bg-v-red/5 disabled:hover:bg-panel'
      : tone === 'primary'
        ? 'border-fg bg-fg text-bg hover:bg-fg/90'
        : 'border-line-2 bg-panel text-fg hover:bg-panel-2'
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${t} ${className}`}
    />
  )
}

// Modal that only enables its action once the user types `word`.
export function ConfirmDialog({
  open,
  title,
  body,
  word = 'delete',
  action,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: React.ReactNode
  word?: string
  action: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')
  const inputId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setTyped('')
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const ready = typed.trim().toLowerCase() === word && !busy
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-line-2 bg-panel p-0 text-fg shadow-[0_24px_60px_-12px_rgb(20_20_18/0.25)] backdrop:bg-fg/25"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onConfirm()
        }}
      >
        <div className="p-5">
          <h2 className="m-0 text-[16px] font-semibold">{title}</h2>
          <div className="mt-2 text-[14px] leading-relaxed text-muted">{body}</div>
          <label htmlFor={inputId} className="mt-4 block text-[13px] text-muted">
            Type <code className="code text-[12.5px] font-medium text-fg">{word}</code> to confirm
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="code mt-1.5 h-9 w-full rounded-md border border-line-2 bg-panel px-3 text-[13.5px] outline-none focus:border-fg"
          />
          {error && <p className="m-0 mt-3 text-[13px] text-v-red">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-panel-2 px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" tone="danger" disabled={!ready} className={ready ? 'border-v-red! bg-v-red! text-white!' : ''}>
            {busy ? 'Deleting…' : action}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

// Minimal global toast: call toast('…') from anywhere on the client.
const TOAST_EVENT = 'taint-blame:toast'

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}

function Toaster() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const on = (e: Event) => {
      clearTimeout(t)
      setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() })
      t = setTimeout(() => setMsg(null), 3500)
    }
    window.addEventListener(TOAST_EVENT, on)
    return () => {
      clearTimeout(t)
      window.removeEventListener(TOAST_EVENT, on)
    }
  }, [])
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50">
      {msg && (
        <div key={msg.key} className="enter flex items-center gap-2 rounded-md bg-fg px-3.5 py-2.5 text-[13.5px] text-bg shadow-lg">
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          {msg.text}
        </div>
      )}
    </div>
  )
}
