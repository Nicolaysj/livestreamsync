// Job orchestration: analyze (discover + match) → download (parallel, fault-isolated)
// → export. A single streamer failing never aborts the run.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderContext } from './providers.js'
import { makeProviders, resolveAnchor } from './providers.js'
import { downloadSegment, SubOnlyError } from './download.js'
import { buildFcpXml } from './fcpxml.js'
import { inferPlatform, sanitizeFilenamePart } from './validate.js'
import { secToTimecode } from './time.js'
import type {
  Analysis,
  AnalyzeInput,
  DownloadOptions,
  POVResult,
  ProgressEvent,
} from './types.js'

/** Run async `fn` over `items` with a concurrency cap, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch {
        // Fault isolation: a throwing item must not abort sibling workers.
        results[i] = undefined as R
      }
    }
  })
  await Promise.all(workers)
  return results
}

export async function analyze(input: AnalyzeInput, ctx: ProviderContext): Promise<Analysis> {
  const providers = makeProviders(ctx)
  const anchor = await resolveAnchor(input.anchorUrl, providers)

  const startSec = Math.max(0, input.startSec)
  let endSec = input.endSec
  if (anchor.durationSec > 0) endSec = Math.min(endSec, anchor.durationSec)
  if (!(endSec > startSec)) throw new Error('Stop time must be after start time (and within the VOD).')

  const window = {
    startMs: anchor.startMs + startSec * 1000,
    endMs: anchor.startMs + endSec * 1000,
    lengthSec: endSec - startSec,
  }

  const povs: POVResult[] = []

  if (input.includeAnchor) {
    povs.push({
      handle: anchor.channel,
      displayName: anchor.channel,
      platform: anchor.platform,
      status: 'covered',
      selected: true,
      segment: {
        platform: anchor.platform,
        vodId: anchor.vodId,
        url: anchor.url,
        title: anchor.title,
        vodStartMs: anchor.startMs,
        durationSec: anchor.durationSec,
        offsetSec: startSec,
        windowLenSec: window.lengthSec,
        leadingGapSec: 0,
        trust: anchor.platform === 'twitch' ? 'tight' : 'coarse',
        subOnly: false,
      },
    })
  }

  const resolved = await mapLimit(input.streamers, 5, async (s): Promise<POVResult> => {
    const platform = s.platform ?? inferPlatform(s.handle)
    try {
      const r = await providers[platform].resolveWindow(s.handle, window)
      return {
        handle: s.handle,
        displayName: r.displayName || s.displayName || s.handle,
        platform,
        avatarUrl: r.avatarUrl,
        status: r.status,
        reason: r.reason,
        segment: r.segment,
        selected: r.status === 'covered' || r.status === 'partial',
      }
    } catch (err) {
      ctx.log?.(`resolveWindow ${s.handle} failed: ${String(err)}`)
      return {
        handle: s.handle,
        displayName: s.displayName || s.handle,
        platform,
        status: 'error',
        reason: 'Lookup failed.',
        selected: false,
      }
    }
  })

  povs.push(...resolved.filter((p): p is POVResult => Boolean(p)))
  return { anchor, window, povs }
}

export interface DownloadCallbacks {
  onProgress?: (ev: ProgressEvent) => void
}

export async function downloadAnalysis(
  analysis: Analysis,
  opts: DownloadOptions,
  ctx: ProviderContext,
  callbacks: DownloadCallbacks = {},
  signal?: AbortSignal,
): Promise<POVResult[]> {
  const targets = analysis.povs.filter((p) => p.selected && p.segment && (p.status === 'covered' || p.status === 'partial'))
  const emit = (p: POVResult, ev: Omit<ProgressEvent, 'handle' | 'platform'>) =>
    callbacks.onProgress?.({ handle: p.handle, platform: p.platform, ...ev })

  // Disambiguate output filenames when two POVs sanitize to the same display name,
  // so concurrent downloads never race to write the same file.
  const nameCounts = new Map<string, number>()
  for (const p of targets) {
    const key = sanitizeFilenamePart(p.displayName).toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const disambiguatorFor = (p: POVResult): string | undefined => {
    const key = sanitizeFilenamePart(p.displayName).toLowerCase()
    return (nameCounts.get(key) ?? 0) > 1 ? `${p.platform}-${p.handle}` : undefined
  }

  for (const p of targets) emit(p, { phase: 'queued' })

  await mapLimit(targets, 3, async (p) => {
    if (signal?.aborted) {
      p.status = 'error'
      p.reason = 'Cancelled'
      emit(p, { phase: 'error', message: 'Cancelled' })
      return
    }
    emit(p, { phase: 'downloading', percent: 0 })
    try {
      const res = await downloadSegment(
        ctx.tools,
        p.segment!,
        p.displayName,
        opts,
        (prog) => emit(p, { phase: 'downloading', percent: prog.percent, speed: prog.speed, eta: prog.eta }),
        signal,
        disambiguatorFor(p),
      )
      p.outputFile = res.outputFile
      p.fileBytes = res.bytes
      emit(p, { phase: 'done', percent: 100 })
    } catch (err) {
      if (err instanceof SubOnlyError) {
        p.status = 'sub-only'
        p.reason = err.message
        emit(p, { phase: 'error', message: 'Subscriber/members-only' })
      } else {
        p.status = 'error'
        p.reason = err instanceof Error ? err.message : 'Download failed'
        emit(p, { phase: 'error', message: p.reason })
      }
    }
  })

  return analysis.povs
}

export interface ExportOptions {
  outDir: string
  fps?: number
  ntsc?: boolean
  width?: number
  height?: number
  pad?: number
}

/** Write a pre-synced FCP7 XML for everything that downloaded. Returns the file path. */
export async function exportTimeline(analysis: Analysis, opts: ExportOptions): Promise<string> {
  const done = analysis.povs.filter((p) => p.outputFile && p.segment)
  if (done.length === 0) throw new Error('Nothing downloaded yet to export.')

  const xml = buildFcpXml({
    sequenceName: `${sanitizeFilenamePart(analysis.anchor.channel)}_LivestreamSync_${secToTimecode(analysis.window.startMs / 1000 - analysis.anchor.startMs / 1000)}`,
    fps: opts.fps ?? 60,
    ntsc: opts.ntsc ?? false,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    pad: opts.pad ?? 4,
    clips: done.map((p) => ({
      name: `${p.displayName}`,
      file: p.outputFile!,
      vodStartMs: p.segment!.vodStartMs,
      offsetSec: p.segment!.offsetSec,
      windowLenSec: p.segment!.windowLenSec,
    })),
  })

  const xmlPath = join(opts.outDir, 'LivestreamSync_timeline.xml')
  await writeFile(xmlPath, xml, 'utf8')
  return xmlPath
}
