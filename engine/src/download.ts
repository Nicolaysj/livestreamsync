// Max-quality, exact-window slice download via yt-dlp (+ ffmpeg for HLS ranges).
// Only the needed fragments are fetched, so this is fast even on multi-hour VODs.

import { mkdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tools } from './tools.js'
import { stream } from './exec.js'
import { sanitizeFilenamePart, clampFinite, isAllowedVodUrl } from './validate.js'
import type { DownloadOptions, Platform, Quality, ResolvedSegment } from './types.js'

export interface DownloadResult {
  outputFile: string
  bytes: number
}

export interface DownloadProgress {
  percent: number // 0..100
  speed?: string
  eta?: string
}

export class SubOnlyError extends Error {
  constructor() {
    super('Subscriber/members-only — connect an authorized account to download.')
    this.name = 'SubOnlyError'
  }
}

function formatSelector(platform: Platform, quality: Quality): string {
  if (platform === 'youtube') {
    // Constrain to HLS (m3u8) renditions so --download-sections fetches only the needed
    // fragments. If no HLS rendition exists, yt-dlp errors out cleanly instead of pulling
    // the whole multi-hour VOD via SABR/DASH.
    const h = quality === '1080' ? '[height<=1080]' : quality === '720' ? '[height<=720]' : ''
    return `b[protocol^=m3u8]${h}/bv*[protocol^=m3u8]${h}+ba[protocol^=m3u8]`
  }
  // twitch — muxed renditions; "best" is Source (e.g. 1080p60)
  if (quality === '1080') return 'best[height<=1080]'
  if (quality === '720') return 'best[height<=720]'
  return 'best'
}

const TIME_RE = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/ // ffmpeg progress
const PCT_RE = /\[download\]\s+([0-9.]+)%/ // yt-dlp textual progress
const SPEED_RE = /(\d+(?:\.\d+)?\s?[KMG]i?B\/s)/

// Intentionally does NOT include a bare 'http error 403' — that also fires on
// expired / geo-blocked / throttled VODs and would mislabel them as sub-only.
const SUBONLY_HINTS = [
  'subscriber',
  'sub-only',
  'only available to',
  'this video is only available',
  'members-only',
  'members only',
  'join this channel',
]

/**
 * Download exactly the segment's window (padded) at the requested quality.
 * Calls `onProgress` as the download streams; honors an AbortSignal for cancellation.
 */
export async function downloadSegment(
  tools: Tools,
  seg: ResolvedSegment,
  displayName: string,
  opts: DownloadOptions,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
  disambiguator?: string,
): Promise<DownloadResult> {
  // SECURITY: re-validate the URL before it reaches yt-dlp, even though the engine
  // normally builds it itself — the Electron path round-trips segments through the
  // (untrusted) renderer. Blocks argument-injection / SSRF via a crafted segment.
  if (!isAllowedVodUrl(seg.url, seg.platform)) throw new Error('Refusing to download an untrusted URL.')
  await mkdir(opts.outDir, { recursive: true })

  const MAX = 86_400 // 24h upper bound for any offset/length
  const pad = clampFinite(opts.padSec ?? 4, 0, 60)
  const offset = clampFinite(seg.offsetSec, 0, MAX)
  const windowLen = clampFinite(seg.windowLenSec, 0, MAX)
  const startSec = Math.max(0, offset - pad)
  const endSec = offset + windowLen + pad
  if (!(Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec)) {
    throw new Error('Invalid segment window.')
  }

  const prefix = opts.filenamePrefix ? `${sanitizeFilenamePart(opts.filenamePrefix)}_` : ''
  const suffix = disambiguator ? `_${sanitizeFilenamePart(disambiguator)}` : ''
  const fileName = `${prefix}${sanitizeFilenamePart(displayName)}${suffix}.mp4`
  const outputFile = join(opts.outDir, fileName)

  const args: string[] = [
    '--no-warnings',
    '--no-playlist',
    '-f',
    formatSelector(seg.platform, opts.quality),
    '--download-sections',
    `*${startSec}-${endSec}`,
    '--ffmpeg-location',
    tools.ffmpeg,
    '--merge-output-format',
    'mp4',
    '-N',
    '8',
    '--newline',
    '-o',
    outputFile,
  ]
  if (seg.platform === 'youtube') {
    // Force an HLS-capable client so --download-sections stays a cheap range fetch
    // (default SABR/DASH would pull the whole multi-hour VOD).
    args.push('--extractor-args', 'youtube:player_client=web_safari,tv,ios')
  }
  // SECURITY: '--' ends option parsing so a URL can never be read as a yt-dlp flag.
  args.push('--', seg.url)

  const expectedLen = Math.max(1, windowLen + 2 * pad)
  let sawSubOnly = false
  let lastPercent = 0

  const handle = stream(tools.ytDlp, args, (line) => {
    const lower = line.toLowerCase()
    if (SUBONLY_HINTS.some((h) => lower.includes(h))) sawSubOnly = true

    // A new "Destination:" line means a fresh stream pass (e.g. YouTube audio after
    // video). Reset so the bar animates again instead of freezing near 100%.
    if (line.includes('Destination:')) lastPercent = 0

    let percent: number | null = null
    const pm = PCT_RE.exec(line)
    if (pm) {
      percent = Number(pm[1])
    } else {
      const tm = TIME_RE.exec(line)
      if (tm) {
        const secs = Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3])
        percent = (secs / expectedLen) * 100
      }
    }
    if (percent != null && Number.isFinite(percent)) {
      lastPercent = Math.max(lastPercent, Math.min(99.5, percent))
      const speed = SPEED_RE.exec(line)?.[1]
      onProgress({ percent: lastPercent, speed })
    }
  }, { timeoutMs: 120_000 })

  const onAbort = () => handle.cancel()
  if (signal) {
    if (signal.aborted) handle.cancel()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  let code: number | null
  try {
    code = await handle.done
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }

  // Remove any partial/corrupt output before throwing, so a retry starts clean.
  const fail = async (err: Error): Promise<never> => {
    await rm(outputFile, { force: true }).catch(() => {})
    throw err
  }
  if (signal?.aborted) return fail(new Error('Cancelled'))
  if (sawSubOnly) return fail(new SubOnlyError())
  if (code !== 0) return fail(new Error('Download failed — the VOD may be unavailable or expired.'))

  let bytes = 0
  try {
    bytes = (await stat(outputFile)).size
  } catch {
    throw new Error('Download produced no file.')
  }
  if (bytes === 0) return fail(new Error('Download produced an empty file.'))

  onProgress({ percent: 100 })
  return { outputFile, bytes }
}
