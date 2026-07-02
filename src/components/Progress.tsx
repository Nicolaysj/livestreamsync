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
  exportError,
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
  exportError?: string
  onExport: () => void
  onOpenFolder: () => void
  onReveal: (file: string) => void
  onNewJob: () => void
  onCancel: () => void
}) {
  // Live state must come from the progress events: the analysis povs cross the
  // IPC boundary by value and only refresh after the whole batch resolves, so
  // p.outputFile / p.status stay stale for the entire run.
  const evFor = (p: POVResult) => progress[`${p.platform}:${p.handle}`]
  const clipDone = (p: POVResult) => evFor(p)?.phase === 'done' || !!p.outputFile
  const clipFailed = (p: POVResult) =>
    evFor(p)?.phase === 'error' || (done && (p.status === 'error' || p.status === 'sub-only'))
  const targets = analysis.povs.filter((p) => p.selected && STATUS_META[p.status].downloadable)
  const finished = targets.filter(clipDone).length
  const overall = targets.length
    ? Math.round(targets.reduce((s, p) => s + (clipDone(p) ? 100 : (evFor(p)?.percent ?? 0)), 0) / targets.length)
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
          const ev = evFor(p)
          const ok = clipDone(p)
          const failed = !ok && clipFailed(p)
          const pct = ok ? 100 : (ev?.percent ?? 0)
          const failReason = ev?.message || p.reason || 'Failed'
          return (
            <div key={`${p.platform}:${p.handle}`} className="flex items-center gap-3 rounded-xl border border-border bg-panel/40 px-3.5 py-3">
              <Avatar src={p.avatarUrl} name={p.displayName} platform={p.platform} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium text-ink">{p.displayName}</span>
                  <span className={clsx('ml-2 max-w-[260px] shrink-0 truncate text-xs tabular-nums', failed ? 'text-danger' : 'text-faint')}>
                    {failed
                      ? failReason
                      : ok
                        ? fmtBytes(p.fileBytes) || 'Done'
                        : `${Math.floor(pct)}%${ev?.speed ? ` · ${ev.speed}` : ''}`}
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
                  <div
                    className={clsx(
                      'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300',
                      failed ? 'bg-danger/70' : ok ? 'bg-ok' : 'bg-accent-strong',
                    )}
                    style={{ width: `${failed ? 100 : pct}%` }}
                  />
                </div>
              </div>
              <div className="w-6 shrink-0 text-center">
                {ok ? (
                  <CheckCircle2 className="h-5 w-5 text-ok" />
                ) : failed ? (
                  <AlertCircle className="h-5 w-5 text-danger" />
                ) : null}
              </div>
              {p.outputFile && (
                <button onClick={() => onReveal(p.outputFile!)} className="no-drag rounded-lg p-1.5 text-faint hover:bg-bg-2 hover:text-ink" title="Reveal file">
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

      {done && exportError && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Timeline export failed: {exportError}</span>
        </div>
      )}

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
