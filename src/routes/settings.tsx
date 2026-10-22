import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { AgentCard, AppShell, Button, ConfirmDialog, PAGE, PageHeader, toast } from '#/components/shell'
import { type VerifyResult, readToken, resetSessions, saveToken, verifyToken } from '#/components/token'

export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: 'Settings · Taint Blame' }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const [saved, setSaved] = useState('')
  useEffect(() => setSaved(readToken()), [])

  return (
    <AppShell>
      <PageHeader title="Settings" description="Connect this dashboard to your ingest token and manage recorded data." />
      <main className={`${PAGE} pt-8 pb-24`}>
        <div className="max-w-[880px] space-y-6">
        <TokenSection saved={saved} onSaved={setSaved} />
        <Card title="Connected agent" description="Agents send events to this workspace with the same ingest token.">
          <div className="max-w-[320px]">
            <AgentCard />
          </div>
        </Card>
          <DangerZone token={saved} />
        </div>
      </main>
    </AppShell>
  )
}

function Card({
  title,
  description,
  danger,
  children,
  footer,
}: {
  title: string
  description: React.ReactNode
  danger?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section className={`overflow-hidden rounded-lg border bg-panel ${danger ? 'border-v-red/30' : 'border-line'}`}>
      <div className="p-5 md:p-6">
        <h2 className={`m-0 text-[15px] font-semibold ${danger ? 'text-v-red' : ''}`}>{title}</h2>
        <p className="m-0 mt-1 text-[14px] text-muted text-pretty">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
      {footer && (
        <div className={`flex flex-wrap items-center gap-3 border-t px-5 py-3 md:px-6 ${danger ? 'border-v-red/20 bg-v-red/[0.03]' : 'border-line bg-panel-2'}`}>
          {footer}
        </div>
      )}
    </section>
  )
}

const STATUS: Record<VerifyResult | 'checking', { text: string; color: string }> = {
  checking: { text: 'Checking…', color: 'var(--color-faint)' },
  connected: { text: 'Connected', color: 'var(--color-v-green)' },
  invalid: { text: 'Invalid token', color: 'var(--color-v-red)' },
  error: { text: 'Could not reach the server', color: 'var(--color-v-amber)' },
}

function TokenSection({ saved, onSaved }: { saved: string; onSaved: (t: string) => void }) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<VerifyResult | 'checking' | null>(null)
  const id = useId()
  useEffect(() => setValue(saved), [saved])

  const dirty = value.trim() !== saved
  const save = () => {
    const t = value.trim()
    if (!saveToken(t)) return toast('This browser blocked local storage')
    onSaved(t)
    toast(t ? 'Token saved in this browser' : 'Token removed')
  }
  const verify = async () => {
    setStatus('checking')
    setStatus(await verifyToken(value.trim()))
  }

  return (
    <Card
      title="API token"
      description={
        <>
          Same token the pi extension uses (<code className="code text-[12.5px] text-fg">~/.taint-blame/config.env</code>). It is stored only in
          this browser and sent as a bearer header for protected actions.
        </>
      }
      footer={
        <>
          <span className="text-[13px] text-faint">{saved ? 'A token is saved in this browser.' : 'No token saved yet.'}</span>
          <div className="ml-auto flex gap-2">
            {saved && (
              <Button
                onClick={() => {
                  setValue('')
                  saveToken('')
                  onSaved('')
                  setStatus(null)
                  toast('Token removed')
                }}
              >
                Remove
              </Button>
            )}
            <Button tone="primary" disabled={!dirty || !value.trim()} onClick={save}>
              Save
            </Button>
          </div>
        </>
      }
    >
      <label htmlFor={id} className="block text-[13px] font-medium">
        Ingest token
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-[280px]">
          <input
            id={id}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setStatus(null)
            }}
            placeholder="Paste TAINT_BLAME_TOKEN"
            autoComplete="off"
            spellCheck={false}
            className="code h-9 w-full rounded-md border border-line-2 bg-panel pr-16 pl-3 text-[13.5px] outline-none focus:border-fg"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-1 right-1 rounded px-2 text-[12.5px] font-medium text-muted hover:bg-panel-2 hover:text-fg"
            aria-pressed={show}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <Button className="h-9" disabled={!value.trim() || status === 'checking'} onClick={verify}>
          Verify
        </Button>
      </div>
      {status && (
        <p className="m-0 mt-2.5 inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: STATUS[status].color }} aria-live="polite">
          <span className="size-1.5 rounded-full" style={{ background: STATUS[status].color }} />
          {STATUS[status].text}
        </p>
      )}
    </Card>
  )
}

function DangerZone({ token }: { token: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const res = await resetSessions(token)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setOpen(false)
    toast(`Deleted ${res.sessions} session${res.sessions === 1 ? '' : 's'}`)
    await router.invalidate()
  }

  return (
    <Card
      danger
      title="Danger zone"
      description="Irreversible actions on everything this workspace has recorded."
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[280px]">
          <p className="m-0 text-[14px] font-medium">Delete all sessions</p>
          <p className="m-0 mt-0.5 text-[13.5px] text-muted">
            {token
              ? 'Removes every session with its inputs, edits and verdicts. Agents keep reporting new ones.'
              : 'Save your API token above to enable this.'}
          </p>
        </div>
        <Button
          tone="danger"
          disabled={!token}
          onClick={() => {
            setError(null)
            setOpen(true)
          }}
        >
          Delete all sessions
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        title="Delete all sessions?"
        body="Every recorded session, input, edit and verdict is removed for good. This cannot be undone."
        action="Delete all sessions"
        busy={busy}
        error={error}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </Card>
  )
}
