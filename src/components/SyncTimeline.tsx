import { clsx } from 'clsx'
import type { POVResult } from '../../engine/src/types'
import { STATUS_META } from '../lib/format'
import { secToTimecode } from '../lib/format'

// Horizontal "sync preview": each POV is a lane over the target window. Downloadable
// POVs show a solid accent bar positioned at their real coverage; non-covering POVs
// show a faint dashed lane so the editor sees exactly what lines up before downloading.
export function SyncTimeline({ povs, lengthSec }: { povs: POVResult[]; lengthSec: number }) {
  const ticks = 4
  return (
    <div className="rounded-2xl border border-border bg-panel/50 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-faint">
        <span className="font-medium uppercase tracking-wide">Sync preview</span>
        <span>{secToTimecode(lengthSec)} window</span>
      </div>

      {/* ruler */}
      <div className="relative mb-1 ml-[136px] h-4">
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 text-[10px] tabular-nums text-faint"
            style={{ left: `${(i / ticks) * 100}%` }}
          >
            {secToTimecode((lengthSec * i) / ticks)}
          </span>
        ))}
      </div>

      <div className="space-y-1.5">
        {povs.map((p) => {
          const meta = STATUS_META[p.status]
          const seg = p.segment
          const leadFrac = seg ? Math.min(1, seg.leadingGapSec / lengthSec) : 0
          const lenFrac = seg ? Math.min(1 - leadFrac, seg.windowLenSec / lengthSec) : 1
          return (
            <div key={`${p.platform}:${p.handle}`} className="flex items-center gap-3">
              <div className="w-[124px] shrink-0 truncate text-right text-xs text-muted">{p.displayName}</div>
              <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-bg-2 ring-1 ring-border/60">
                {meta.downloadable && seg ? (
                  <div
                    className={clsx(
                      'absolute inset-y-0 rounded-md',
                      p.status === 'partial'
                        ? 'bg-accent-soft border border-accent-line'
                        : 'bg-accent-strong',
                    )}
                    style={{ left: `${leadFrac * 100}%`, width: `${Math.max(2, lenFrac * 100)}%` }}
                  >
                    <span
                      className={clsx(
                        'absolute inset-0 flex items-center justify-center text-[10px] font-medium',
                        p.status === 'partial' ? 'text-accent-text' : 'text-accent-ink',
                      )}
                    >
                      {seg.trust === 'coarse' ? '~ ' : ''}
                      {p.status === 'partial' ? 'partial' : 'in sync'}
                    </span>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-px w-[calc(100%-16px)] border-t border-dashed border-border-2" />
                    <span className="absolute text-[10px] text-faint">{meta.label}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
