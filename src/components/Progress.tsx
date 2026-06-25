import { clsx } from 'clsx'
import { CheckCircle2, FolderOpen, FileVideo, Film, X, Plus, AlertCircle, Clapperboard } from 'lucide-react'
import type { Analysis, POVResult, ProgressEvent } from '../../engine/src/types'
import { Avatar } from './bits'
import { Button } from './ui'
import { STATUS_META, fmtBytes } from '../lib/format'

export function Progress({
  analysis,
  progress,
  done,
  xmlPath,
  exporting,
  onExport,
  onOpenFolder,
  onReveal,
  onNewJob,
  onCancel,
}: {
  analysis: Analysis
  progress: Record<string, ProgressEvent>
  done: boolean
  xmlPath?: string
  exporting: boolean
  onExport: () => void
  onOpenFolder: () => void
  onReveal: (file: string) => void
  onNewJob: () => void
  onCancel: () => void
}) {
  const targets = analysis.povs.filter((p) => p.selected && STATUS_META[p.status].downloadable)
  const finished = targets.filter((p) => p.outputFile).length
  const overall = targets.length
    ? Math.round(targets.reduce((s, p) => s + (progress[`${p.platform}:${p.handle}`]?.percent ?? 0), 0) / targets.length)
    : 0

  return (
    <div className="flex h-full flex-col px-8 py-6">
      <div className="mb-5 text-center">
        {done ? (
          <>
            <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-ok/15">
              <CheckCircle2 className="h-7 w-7 text-ok" />
            </div>
            <h2 className="text-xl font-semibold text-ink">{finished} clip{finished === 1 ? '' : 's'} ready</h2>
            <p className="mt-1 text-sm text-muted">All angles synced to {analysis.anchor.channel}'s timeline.</p>
          </>
        ) : (
          <>
            <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/15">
              <Film className="h-7 w-7 animate-pulse text-accent-2" />
            </div>
            <h2 className="text-xl font-semibold text-ink">Downloading {targets.length} clips…</h2>
            <p className="mt-1 text-sm text-muted">{finished} of {targets.length} done · {overall}%</p>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {targets.map((p) => {
          const ev = progress[`${p.platform}:${p.handle}`]
          const pct = p.outputFile ? 100 : (ev?.percent ?? 0)
          const failed = p.status === 'error' || p.status === 'sub-only'
          return (
            <div key={`${p.platform}:${p.handle}`} className="flex items-center gap-3 rounded-xl border border-border bg-panel/40 px-3.5 py-3">
              <Avatar src={p.avatarUrl} name={p.displayName} platform={p.platform} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-ink">{p.displayName}</span>
                  <span className="ml-2 shrink-0 text-xs tabular-nums text-faint">
                    {failed ? '' : p.outputFile ? fmtBytes(p.fileBytes) : `${Math.floor(pct)}%${ev?.speed ? ` · ${ev.speed}` : ''}`}
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
                  <div
                    className={clsx(
                      'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300',
                      failed ? 'bg-danger/60' : p.outputFile ? 'bg-ok' : 'bg-gradient-to-r from-accent to-accent-2',
                    )}
                    style={{ width: `${failed ? 100 : pct}%` }}
                  />
                </div>
              </div>
              <div className="w-6 shrink-0 text-center">
                {p.outputFile ? (
                  <CheckCircle2 className="h-5 w-5 text-ok" />
                ) : failed ? (
                  <AlertCircle className="h-5 w-5 text-danger" />
                ) : null}
              </div>
              {p.outputFile && (
                <button onClick={() => onReveal(p.outputFile!)} className="no-drag rounded-lg p-1.5 text-faint hover:bg-white/10 hover:text-ink" title="Reveal file">
                  <FileVideo className="h-4 w-4" />
                </button>
              )}
            </div>
          )
        })}

        {done && analysis.povs.some((p) => !STATUS_META[p.status].downloadable || p.status === 'error' || p.status === 'sub-only') && (
          <SkippedList povs={analysis.povs} />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        {done ? (
          <>
            <Button variant="ghost" onClick={onNewJob}>
              <Plus className="h-4 w-4" /> New job
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="soft" onClick={onExport} disabled={exporting || !!xmlPath}>
                <Clapperboard className="h-4 w-4" /> {xmlPath ? 'Timeline exported' : exporting ? 'Exporting…' : 'Export timeline'}
              </Button>
              <Button onClick={onOpenFolder}>
                <FolderOpen className="h-4 w-4" /> Open folder
              </Button>
            </div>
          </>
        ) : (
          <Button variant="danger" onClick={onCancel} className="ml-auto">
            <X className="h-4 w-4" /> Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

function SkippedList({ povs }: { povs: POVResult[] }) {
  const skipped = povs.filter((p) => !STATUS_META[p.status].downloadable || p.status === 'error' || p.status === 'sub-only')
  if (skipped.length === 0) return null
  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-bg-2/50 px-4 py-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Skipped</div>
      <div className="space-y-1">
        {skipped.map((p) => (
          <div key={`${p.platform}:${p.handle}`} className="flex items-center justify-between text-xs">
            <span className="text-muted">{p.displayName}</span>
            <span className="text-faint">{p.reason || STATUS_META[p.status].label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
