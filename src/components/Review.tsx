import { ChevronLeft, Download, Check } from 'lucide-react'
import { clsx } from 'clsx'
import type { Analysis, POVResult } from '../../engine/src/types'
import { Avatar, StatusChip } from './bits'
import { SyncTimeline } from './SyncTimeline'
import { Button } from './ui'
import { STATUS_META, secToTimecode } from '../lib/format'

export function Review({
  analysis,
  onBack,
  onToggle,
  onDownload,
}: {
  analysis: Analysis
  onBack: () => void
  onToggle: (p: POVResult) => void
  onDownload: () => void
}) {
  const found = analysis.povs.filter((p) => STATUS_META[p.status].downloadable).length
  const selected = analysis.povs.filter((p) => p.selected && STATUS_META[p.status].downloadable).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-8 pt-6">
        <button onClick={onBack} className="no-drag inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Edit
        </button>
        <div className="text-center">
          <div className="text-sm font-medium text-ink">
            {found} of {analysis.povs.length} POVs found
          </div>
          <div className="text-xs text-faint">
            {analysis.anchor.channel} · {secToTimecode(analysis.window.lengthSec)} window
          </div>
        </div>
        <div className="w-12" />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-8 py-5">
        <SyncTimeline povs={analysis.povs} lengthSec={analysis.window.lengthSec} />

        <div className="space-y-2">
          {analysis.povs.map((p) => {
            const meta = STATUS_META[p.status]
            const can = meta.downloadable
            return (
              <button
                key={`${p.platform}:${p.handle}`}
                onClick={() => can && onToggle(p)}
                disabled={!can}
                className={clsx(
                  'no-drag flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all',
                  can ? 'cursor-pointer hover:border-accent/40' : 'cursor-default opacity-60',
                  p.selected && can ? 'border-accent/50 bg-accent/[0.06]' : 'border-border bg-panel/40',
                )}
              >
                <span
                  className={clsx(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                    p.selected && can ? 'border-accent bg-accent text-white' : 'border-border-2',
                    !can && 'opacity-0',
                  )}
                >
                  {p.selected && can && <Check className="h-3.5 w-3.5" />}
                </span>
                <Avatar src={p.avatarUrl} name={p.displayName} platform={p.platform} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{p.displayName}</div>
                  <div className="truncate text-xs text-faint">
                    {p.segment ? `In sync at ${secToTimecode(p.segment.offsetSec)} in their VOD` : p.reason || meta.label}
                  </div>
                </div>
                <StatusChip status={p.status} />
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/60 px-8 py-4">
        <span className="text-sm text-muted">
          {selected} clip{selected === 1 ? '' : 's'} selected
        </span>
        <Button onClick={onDownload} disabled={selected === 0} className="px-6 py-3 text-base">
          <Download className="h-4 w-4" /> Download {selected > 0 ? selected : ''} {selected === 1 ? 'clip' : 'clips'}
        </Button>
      </div>
    </div>
  )
}
