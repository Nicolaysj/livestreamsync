import { Folder, Sparkles, Film, AlertCircle, Clapperboard } from 'lucide-react'
import type { RosterEntry } from '../../engine/src/types'
import { Button, Field, Segmented, Toggle } from './ui'
import { StreamerInput } from './StreamerInput'
import { parseTimecodeToSec, secToTimecode } from '../lib/format'

export interface SetupForm {
  anchorUrl: string
  start: string
  stop: string
  handles: string[]
  outDir: string
  quality: 'source' | '1080' | '720'
  includeAnchor: boolean
  exportXml: boolean
}

function durationLabel(start: string, stop: string): string | null {
  try {
    const a = parseTimecodeToSec(start)
    const b = parseTimecodeToSec(stop)
    if (b > a) return secToTimecode(b - a)
  } catch {
    /* ignore */
  }
  return null
}

export function Setup({
  form,
  setForm,
  roster,
  onAnalyze,
  analyzing,
  error,
  warning,
}: {
  form: SetupForm
  setForm: (f: SetupForm) => void
  roster: RosterEntry[]
  onAnalyze: () => void
  analyzing: boolean
  error?: string
  /** Non-blocking environment problem (e.g. yt-dlp/ffmpeg missing). */
  warning?: string
}) {
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setForm({ ...form, [k]: v })
  const dur = durationLabel(form.start, form.stop)
  const canRun = form.anchorUrl.trim() && form.start.trim() && form.stop.trim() && form.handles.length > 0

  const pickFolder = async () => {
    const dir = await window.livestreamsync?.pickFolder?.()
    if (dir) set('outDir', dir)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-panel/60 px-3 py-1 text-xs text-muted">
          <Sparkles className="h-3.5 w-3.5 text-accent-2" /> Multi-POV sync
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Grab every angle, perfectly synced.</h1>
        <p className="mt-1.5 text-sm text-muted">
          One VOD, one time range, your streamer list — LivestreamSync finds and downloads each synced clip.
        </p>
      </div>

      <div className="space-y-5">
        <Field
          label="Anchor VOD URL"
          placeholder="https://www.twitch.tv/videos/…"
          value={form.anchorUrl}
          onChange={(e) => set('anchorUrl', e.target.value)}
          hint="The POV whose timeline your start/stop times refer to."
        />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start" placeholder="04:40:21" value={form.start} onChange={(e) => set('start', e.target.value)} />
          <div className="relative">
            <Field label="Stop" placeholder="04:55:50" value={form.stop} onChange={(e) => set('stop', e.target.value)} />
            {dur && (
              <span className="absolute right-3 top-[34px] rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-2">
                {dur}
              </span>
            )}
          </div>
        </div>

        <StreamerInput handles={form.handles} onChange={(h) => set('handles', h)} roster={roster} />

        <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-panel/40 p-4">
          <div className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">Save to</span>
            <button
              onClick={pickFolder}
              className="no-drag flex w-full items-center gap-2 rounded-xl border border-border bg-bg-2 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:border-accent/40"
            >
              <Folder className="h-4 w-4 shrink-0 text-faint" />
              <span className="truncate">{form.outDir || 'Choose a folder…'}</span>
            </button>
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">Quality</span>
            <Segmented
              value={form.quality}
              onChange={(v) => set('quality', v)}
              options={[
                { value: 'source', label: 'Source' },
                { value: '1080', label: '1080p' },
                { value: '720', label: '720p' },
              ]}
            />
          </div>
        </div>

        <div className="flex items-center gap-6 px-1">
          <Toggle checked={form.includeAnchor} onChange={(v) => set('includeAnchor', v)} label="Include anchor as reference" />
          <Toggle checked={form.exportXml} onChange={(v) => set('exportXml', v)} label="Export synced timeline (XML)" />
        </div>

        {warning && (
          <div className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button onClick={onAnalyze} disabled={!canRun || analyzing} className="w-full py-3 text-base">
          {analyzing ? (
            <>
              <Film className="h-4 w-4 animate-pulse" /> Finding POVs…
            </>
          ) : (
            <>
              <Clapperboard className="h-4 w-4" /> Find POVs
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
