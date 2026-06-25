// Renderer API shim. In Electron, `window.povsync` is provided by the preload bridge.
// In a plain browser (UI development / preview), we fall back to a realistic MOCK so
// the whole flow is clickable without the desktop shell.

import type { PovsyncApi } from '../../shared/ipc'
import type { Analysis, AnalyzeInput, POVResult, ProgressEvent, RosterEntry } from '../../engine/src/types'

export const isElectron = typeof window !== 'undefined' && !!window.povsync

// ---------- Browser mock ----------

const MOCK_ROSTER: RosterEntry[] = [
  { id: 'r1', displayName: 'Pokimane', twitch: 'pokimane' },
  { id: 'r2', displayName: 'LilyPichu', twitch: 'lilypichu' },
  { id: 'r3', displayName: 'Masayoshi', twitch: 'masayoshi' },
  { id: 'r4', displayName: 'Sydeon', twitch: 'sydeon', youtube: '@sydeon' },
  { id: 'r5', displayName: 'Peter Park', twitch: 'peterpark' },
  { id: 'r6', displayName: 'Michael Reeves', twitch: 'michaelreeves' },
]

function mockAnalysis(input: AnalyzeInput): Analysis {
  const anchorStartMs = Date.parse('2026-06-23T22:30:10Z')
  const startMs = anchorStartMs + input.startSec * 1000
  const lengthSec = Math.max(1, input.endSec - input.startSec)
  const sample: Record<string, { status: POVResult['status']; offset: number; name: string; yt?: boolean }> = {
    pokimane: { status: 'covered', offset: 7847, name: 'Pokimane' },
    lilypichu: { status: 'covered', offset: 16064, name: 'LilyPichu' },
    masayoshi: { status: 'covered', offset: 26710, name: 'Masayoshi' },
    sydeon: { status: 'covered', offset: 17185, name: 'Sydeon' },
    peterpark: { status: 'gap', offset: 0, name: 'Peter Park' },
    michaelreeves: { status: 'no-vods', offset: 0, name: 'Michael Reeves' },
  }
  const povs: POVResult[] = []
  if (input.includeAnchor) {
    povs.push({
      handle: 'QuarterJade', displayName: 'QuarterJade', platform: 'twitch', status: 'covered', selected: true,
      segment: { platform: 'twitch', vodId: '0', url: '', title: 'meccha chameleon ALL DAY', vodStartMs: anchorStartMs, durationSec: 37192, offsetSec: input.startSec, windowLenSec: lengthSec, leadingGapSec: 0, trust: 'tight', subOnly: false },
    })
  }
  for (const s of input.streamers) {
    const key = s.handle.replace(/^@/, '').toLowerCase()
    const m = sample[key] ?? { status: 'covered' as const, offset: 3600, name: s.handle }
    const covered = m.status === 'covered' || m.status === 'partial'
    povs.push({
      handle: s.handle, displayName: m.name, platform: m.yt ? 'youtube' : 'twitch', status: m.status, selected: covered,
      reason: m.status === 'gap' ? 'They have VODs, but none cover this moment.' : m.status === 'no-vods' ? 'This channel keeps no public VODs.' : undefined,
      segment: covered ? { platform: 'twitch', vodId: 'x', url: '', title: '', vodStartMs: startMs - m.offset * 1000, durationSec: 30000, offsetSec: m.offset, windowLenSec: lengthSec, leadingGapSec: 0, trust: 'tight', subOnly: false } : undefined,
    })
  }
  return {
    anchor: { url: input.anchorUrl, platform: 'twitch', vodId: '2803809973', title: 'meccha chameleon ALL DAY', channel: 'QuarterJade', startMs: anchorStartMs, durationSec: 37192 },
    window: { startMs, endMs: startMs + lengthSec * 1000, lengthSec },
    povs,
  }
}

let mockProgressCb: ((ev: ProgressEvent) => void) | null = null

const mockApi: PovsyncApi = {
  analyze: async (input) => {
    await delay(900)
    return mockAnalysis(input)
  },
  download: async (req) => {
    const targets = req.analysis.povs.filter((p) => p.selected && p.segment)
    await Promise.all(
      targets.map(async (p, i) => {
        await delay(300 * i)
        for (let pct = 0; pct <= 100; pct += 8) {
          mockProgressCb?.({ handle: p.handle, platform: p.platform, phase: 'downloading', percent: pct, speed: `${(40 + Math.round(pct / 3))} MB/s` })
          await delay(120)
        }
        p.outputFile = `C:\\Users\\You\\Videos\\POVsync\\POVsync_${p.displayName}.mp4`
        p.fileBytes = 690 * 1024 * 1024
        mockProgressCb?.({ handle: p.handle, platform: p.platform, phase: 'done', percent: 100 })
      }),
    )
    return req.analysis.povs
  },
  cancel: async () => {},
  exportTimeline: async () => 'C:\\Users\\You\\Videos\\POVsync\\POVsync_timeline.xml',
  pickFolder: async () => 'C:\\Users\\You\\Videos\\POVsync',
  openFolder: async () => {},
  revealFile: async () => {},
  getRoster: async () => MOCK_ROSTER,
  saveRoster: async () => {},
  getDefaults: async () => ({ outDir: 'C:\\Users\\You\\Videos\\POVsync' }),
  checkTools: async () => ({ ytDlp: true, ffmpeg: true }),
  onProgress: (cb) => {
    mockProgressCb = cb
    return () => {
      if (mockProgressCb === cb) mockProgressCb = null
    }
  },
  minimize: () => {},
  toggleMaximize: () => {},
  close: () => {},
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const api: PovsyncApi = (typeof window !== 'undefined' && window.povsync) || mockApi
