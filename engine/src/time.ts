// Time parsing / formatting helpers.

const HHMMSS = /^(\d{1,2}):([0-5]?\d):([0-5]?\d)(?:\.(\d+))?$/
const MMSS = /^(\d{1,3}):([0-5]?\d)(?:\.(\d+))?$/
const UNITS = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i
const PLAIN_SECONDS = /^\d+(?:\.\d+)?$/

/**
 * Parse a human timecode into seconds. Accepts:
 *   "04:40:21", "40:21", "150" (seconds), "1h2m3s", "04h40m21s".
 * Throws on anything else.
 */
export function parseTimecodeToSec(raw: string): number {
  const s = raw.trim().toLowerCase()
  if (s === '') throw new Error('Empty timecode')

  if (PLAIN_SECONDS.test(s)) return Number(s)

  let m = HHMMSS.exec(s)
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac(m[4])

  m = MMSS.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2]) + frac(m[3])

  m = UNITS.exec(s)
  if (m && (m[1] || m[2] || m[3])) {
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
  }

  throw new Error(`Unrecognized timecode: "${raw}"`)
}

function frac(d: string | undefined): number {
  return d ? Number(`0.${d}`) : 0
}

/** Extract a Twitch/YouTube `?t=` deep-link offset (seconds) from a URL, or null. */
export function parseTParam(url: string): number | null {
  try {
    const u = new URL(url)
    const t = u.searchParams.get('t')
    if (!t) return null
    if (PLAIN_SECONDS.test(t)) return Number(t)
    const m = UNITS.exec(t.toLowerCase())
    if (m && (m[1] || m[2] || m[3])) {
      return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
    }
    return null
  } catch {
    return null
  }
}

/** Format seconds as H:MM:SS (or M:SS under an hour). */
export function secToTimecode(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** ISO 8601 → epoch ms. Throws if unparseable. */
export function isoToMs(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Bad ISO timestamp: ${iso}`)
  return ms
}

/** Parse a Twitch Helix-style duration string like "6h26m14s" → seconds. */
export function helixDurToSec(d: string): number {
  const m = UNITS.exec(d.trim().toLowerCase())
  if (!m) return 0
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}
