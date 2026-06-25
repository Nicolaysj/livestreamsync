// YouTube provider: discovery via yt-dlp. Anchors on `release_timestamp` (the true
// broadcast start; validated against start+duration≈end), trust = 'coarse' so the
// downstream audio fine-sync owns final alignment for YouTube/mixed timelines.

import type { Tools } from './tools.js'
import { run } from './exec.js'
import { isValidYouTubeHandle, isValidYouTubeVideoId, normalizeHandle } from './validate.js'
import type { AnchorRef } from './types.js'
import type { Provider, POVResolution, ProviderContext } from './providers.js'

/**
 * yt-dlp issue #5634: `release_timestamp` can occasionally be the broadcast END time
 * rather than the start. If start+duration overshoots "now" by more than a slack, treat
 * the value as the end and subtract the duration to recover the true start.
 */
function correctedStartSec(relSec: number, durSec: number): number {
  if (Number.isFinite(relSec) && relSec > 0 && Number.isFinite(durSec) && durSec > 0) {
    if (relSec + durSec > Date.now() / 1000 + 120) {
      const corrected = relSec - durSec
      if (corrected > 0) return corrected
    }
  }
  return relSec
}

const SEP = '' // unit separator unlikely to appear in titles

export class YouTubeProvider implements Provider {
  readonly platform = 'youtube' as const
  constructor(private ctx: ProviderContext) {}

  private get tools(): Tools {
    return this.ctx.tools
  }

  async getAnchorInfo(videoId: string): Promise<AnchorRef> {
    if (!isValidYouTubeVideoId(videoId)) throw new Error('Invalid YouTube video id.')
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const { code, stdout } = await run(
      this.tools.ytDlp,
      ['--no-warnings', '--print', ['%(release_timestamp)s', '%(timestamp)s', '%(duration)s', '%(channel)s', '%(title)s'].join(SEP), url],
      { timeoutMs: 60_000 },
    )
    if (code !== 0) throw new Error('Could not read the YouTube anchor. Is the link correct / public?')
    const [rel, ts, dur, channel, title] = stdout.trim().split(SEP)
    // Prefer release_timestamp (broadcast start). Guard against the known #5634 case
    // where it can be the END time: if release+duration overshoots "now" badly, distrust it.
    const durSec = Number(dur)
    let startSec = correctedStartSec(Number(rel), durSec)
    if (!Number.isFinite(startSec) || startSec <= 0) startSec = Number(ts)
    if (!Number.isFinite(startSec) || startSec <= 0) throw new Error('YouTube anchor has no start time.')
    return {
      url,
      platform: 'youtube',
      vodId: videoId,
      title: title || `YouTube ${videoId}`,
      channel: channel || 'Unknown',
      startMs: startSec * 1000,
      durationSec: Number.isFinite(durSec) ? durSec : 0,
    }
  }

  async getUserMeta(): Promise<{ displayName: string; avatarUrl?: string } | null> {
    return null // resolved lazily from stream metadata
  }

  private channelStreamsUrl(handle: string): string {
    const h = normalizeHandle(handle, 'youtube')
    return h.startsWith('UC')
      ? `https://www.youtube.com/channel/${h}/streams`
      : `https://www.youtube.com/${h}/streams`
  }

  async resolveWindow(handle: string, win: { startMs: number; endMs: number; lengthSec: number }): Promise<POVResolution> {
    if (!isValidYouTubeHandle(handle)) {
      return { status: 'error', reason: 'Not a valid YouTube handle.', displayName: handle }
    }
    const streamsUrl = this.channelStreamsUrl(handle)

    // Stage 1: enumerate the newest past streams (ids only, cheap).
    let ids: string[]
    try {
      const listed = await run(
        this.tools.ytDlp,
        ['--no-warnings', '--flat-playlist', '-I', '1:12', '--print', '%(id)s', streamsUrl],
        { timeoutMs: 45_000 },
      )
      ids = listed.stdout.split('\n').map((s) => s.trim()).filter((s) => isValidYouTubeVideoId(s))
    } catch {
      return { status: 'error', reason: 'Couldn’t reach YouTube.', displayName: handle }
    }
    if (ids.length === 0) {
      return { status: 'no-vods', reason: 'No past live streams found on this channel.', displayName: handle }
    }

    // Stage 2: resolve each candidate's true start (release_timestamp) + duration.
    const urls = ids.map((id) => `https://www.youtube.com/watch?v=${id}`)
    const { code, stdout } = await run(
      this.tools.ytDlp,
      ['--no-warnings', '--print', ['%(id)s', '%(release_timestamp)s', '%(duration)s', '%(live_status)s', '%(channel)s', '%(title)s'].join(SEP), ...urls],
      { timeoutMs: 120_000 },
    )
    if (code !== 0 && !stdout.trim()) {
      return { status: 'error', reason: 'Couldn’t read YouTube stream details.', displayName: handle }
    }

    let displayName = handle
    let best: { id: string; start: number; dur: number; title: string; overlap: number; processing: boolean } | null = null
    for (const line of stdout.split('\n')) {
      const parts = line.split(SEP)
      if (parts.length < 6) continue
      const [id, rel, dur, liveStatus, channel, title] = parts
      if (channel) displayName = channel
      const durationSec = Number(dur)
      const startSec = correctedStartSec(Number(rel), durationSec)
      if (!Number.isFinite(startSec) || startSec <= 0 || !Number.isFinite(durationSec)) continue
      const start = startSec * 1000
      const end = start + durationSec * 1000
      const overlap = Math.min(end, win.endMs) - Math.max(start, win.startMs)
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { id, start, dur: durationSec, title: title || `YouTube ${id}`, overlap, processing: liveStatus === 'post_live' }
      }
    }

    if (!best) {
      return { status: 'gap', reason: 'They streamed nearby, but not during this window.', displayName }
    }
    if (best.processing) {
      return { status: 'processing', reason: 'Their VOD is still processing — try again shortly.', displayName }
    }

    const end = best.start + best.dur * 1000
    const fullyCovers = best.start <= win.startMs && end >= win.endMs
    const offsetSec = Math.max(0, (win.startMs - best.start) / 1000)
    const leadingGapSec = Math.max(0, (best.start - win.startMs) / 1000)
    const windowLenSec = Math.max(0, (Math.min(end, win.endMs) - Math.max(best.start, win.startMs)) / 1000)

    return {
      status: fullyCovers ? 'covered' : 'partial',
      displayName,
      reason: fullyCovers ? undefined : 'Joined partway through this window.',
      segment: {
        platform: 'youtube',
        vodId: best.id,
        url: `https://www.youtube.com/watch?v=${best.id}`,
        title: best.title,
        vodStartMs: best.start,
        durationSec: best.dur,
        offsetSec,
        windowLenSec,
        leadingGapSec,
        trust: 'coarse',
        subOnly: false,
      },
    }
  }
}
