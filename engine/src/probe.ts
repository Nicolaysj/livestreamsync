// Reading a downloaded clip's real frame size. We only bundle ffmpeg's resolver,
// so this parses `ffmpeg -i`'s stream summary rather than calling ffprobe.

import { run } from './exec.js'

export interface FrameSize {
  width: number
  height: number
}

// "Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(...), 2560x1440 [SAR 1:1 ...]"
// The \b guards keep codec tags like 0x31637661 from matching as a size.
const SIZE_RE = /\b(\d{2,5})x(\d{2,5})\b/

/** Frame size of the first video stream in an ffmpeg `-i` banner, or undefined. */
export function parseFrameSize(ffmpegOutput: string): FrameSize | undefined {
  for (const line of ffmpegOutput.split(/\r?\n/)) {
    const at = line.indexOf(': Video:')
    if (!line.trimStart().startsWith('Stream #') || at < 0 || line.includes('attached pic')) continue
    const m = SIZE_RE.exec(line.slice(at))
    if (m) return { width: Number(m[1]), height: Number(m[2]) }
  }
  return undefined
}

/**
 * Probe a local media file's frame size. Never throws — a failed probe just
 * leaves the timeline export to fall back to its default size.
 */
export async function probeFrameSize(ffmpeg: string, file: string): Promise<FrameSize | undefined> {
  try {
    // With no output file ffmpeg prints the input summary and exits 1 — expected.
    const res = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], { timeoutMs: 15_000, maxBuffer: 256 * 1024 })
    return parseFrameSize(res.stderr)
  } catch {
    return undefined
  }
}
