import { useEffect, useState } from 'react'
import { ArrowUpCircle, RotateCw } from 'lucide-react'
import { api } from '../lib/api'
import type { UpdateStatus } from '../../shared/ipc'

// "Notify, install on click": the title-bar pill reflects the update lifecycle.
// available → click to download · downloading → progress · downloaded → click to restart.
export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'none' })
  useEffect(() => api.onUpdateStatus(setStatus), [])

  if (status.state === 'none' || status.state === 'error') return null

  const base =
    'no-drag inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all'

  if (status.state === 'available') {
    return (
      <button
        onClick={() => api.downloadUpdate()}
        title={`Version ${status.version} is available — click to download`}
        className={`${base} border-accent-line bg-accent-soft text-accent-text hover:brightness-95`}
      >
        <ArrowUpCircle className="h-3.5 w-3.5" /> Update available
      </button>
    )
  }

  if (status.state === 'downloading') {
    return (
      <span className={`${base} border-border bg-bg-2 text-muted`}>
        <RotateCw className="h-3.5 w-3.5 animate-spin" /> Updating… {status.percent}%
      </span>
    )
  }

  // downloaded
  return (
    <button
      onClick={() => api.installUpdate()}
      title={`Version ${status.version} downloaded — click to restart & install`}
      className={`${base} border-accent-strong bg-accent-strong text-accent-ink hover:brightness-110`}
    >
      <ArrowUpCircle className="h-3.5 w-3.5" /> Restart to update
    </button>
  )
}
