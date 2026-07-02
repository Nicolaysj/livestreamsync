import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, ArrowUpCircle, Check, AlertCircle, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { UpdateStatus } from '../../shared/ipc'

// Discoverable updates control in the title bar: shows the current version, a manual
// "Check for updates" action, and reflects the live auto-update lifecycle. A dot on the
// trigger appears when an update is available/downloading/ready.
export function UpdatesMenu() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [version, setVersion] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getVersion().then(setVersion).catch(() => {})
    return api.onUpdateStatus(setStatus)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const ready = status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Updates"
        className="no-drag relative inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-bg-2 hover:text-ink"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <ChevronDown className="h-3 w-3" />
        {ready && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent-strong" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border bg-panel p-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-ink">LivestreamSync</span>
            <span className="font-mono text-xs text-muted">v{version || '—'}</span>
          </div>
          <Body status={status} />
        </div>
      )}
    </div>
  )
}

const row = 'flex items-center gap-2 text-sm'
const action =
  'no-drag flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all'

function CheckButton() {
  return (
    <button onClick={() => api.checkForUpdate()} className={clsx(action, 'border border-border text-ink hover:bg-bg-2')}>
      <RefreshCw className="h-4 w-4" /> Check for updates
    </button>
  )
}

function Body({ status }: { status: UpdateStatus }) {
  // On macOS we can't auto-install (unsigned), so the "Download" action opens the GitHub
  // release page for a manual update instead of triggering the in-app downloader.
  const isMac = api.platform === 'darwin'
  switch (status.state) {
    case 'checking':
      return (
        <p className={clsx(row, 'text-muted')}>
          <RefreshCw className="h-4 w-4 animate-spin" /> Checking for updates…
        </p>
      )
    case 'available':
      return (
        <div className="space-y-2.5">
          <p className={clsx(row, 'text-ink')}>
            <ArrowUpCircle className="h-4 w-4 text-accent-text" /> Version {status.version} is available.
          </p>
          <button onClick={() => api.downloadUpdate()} className={clsx(action, 'bg-accent-strong text-accent-ink hover:brightness-110')}>
            {isMac ? (
              <>
                <ExternalLink className="h-4 w-4" /> Download from GitHub
              </>
            ) : (
              'Download update'
            )}
          </button>
        </div>
      )
    case 'downloading':
      return (
        <div className="space-y-2">
          <p className={clsx(row, 'text-muted')}>
            <RefreshCw className="h-4 w-4 animate-spin" /> Downloading… {status.percent}%
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full bg-accent-strong transition-[width]" style={{ width: `${status.percent}%` }} />
          </div>
        </div>
      )
    case 'downloaded':
      return (
        <div className="space-y-2.5">
          <p className={clsx(row, 'text-ink')}>
            <Check className="h-4 w-4 text-ok" /> Version {status.version} ready.
          </p>
          <button onClick={() => api.installUpdate()} className={clsx(action, 'bg-accent-strong text-accent-ink hover:brightness-110')}>
            Restart &amp; install
          </button>
        </div>
      )
    case 'error':
      return (
        <div className="space-y-2.5">
          <p className={clsx(row, 'text-danger')}>
            <AlertCircle className="h-4 w-4" /> Couldn’t check for updates.
          </p>
          {status.message && <p className="break-words text-xs text-faint">{status.message}</p>}
          <CheckButton />
        </div>
      )
    case 'none':
      return (
        <div className="space-y-2.5">
          <p className={clsx(row, 'text-muted')}>
            <Check className="h-4 w-4 text-ok" /> You’re up to date.
          </p>
          <CheckButton />
        </div>
      )
    default: // idle
      return <CheckButton />
  }
}
