// Core shared types for the LivestreamSync engine. Framework-agnostic — no Electron/DOM deps.

export type Platform = 'twitch' | 'youtube'
export type Quality = 'source' | '1080' | '720'

export type POVStatus =
  | 'covered' // a VOD fully brackets the target window
  | 'partial' // a VOD overlaps but the streamer went live / offline mid-window
  | 'gap' // channel has archives, but none cover this window (they were offline)
  | 'no-vods' // channel keeps no archives at all
  | 'sub-only' // a covering VOD exists but is subscriber/members-only
  | 'processing' // covering VOD is still being processed by the platform
  | 'error' // lookup failed (network / rate-limit / unknown handle)

/** An absolute wall-clock window, in epoch milliseconds (UTC). */
export interface AbsWindow {
  startMs: number
  endMs: number
  lengthSec: number
}

/** The anchor VOD whose timeline the editor's start/stop refer to. */
export interface AnchorRef {
  url: string
  platform: Platform
  vodId: string
  title: string
  channel: string
  startMs: number // wall-clock of the anchor VOD's position 0
  durationSec: number
}

/** A concrete slice to pull from one streamer's VOD. */
export interface ResolvedSegment {
  platform: Platform
  vodId: string
  url: string
  title: string
  vodStartMs: number // wall-clock of this VOD's position 0
  durationSec: number
  offsetSec: number // where the window begins inside THIS vod (clamped >= 0)
  windowLenSec: number // length of the slice to download
  leadingGapSec: number // if they went live mid-window, seconds before they appear
  trust: 'tight' | 'coarse' // twitch=tight; youtube=coarse (approx. start time, shown with '~')
  subOnly: boolean
}

export interface POVResult {
  handle: string
  displayName: string
  platform: Platform
  avatarUrl?: string
  status: POVStatus
  reason?: string
  segment?: ResolvedSegment
  selected: boolean
  outputFile?: string
  fileBytes?: number
  /** Per-POV chat opt-in (Twitch only); when unset, DownloadOptions.chat applies. */
  chatSelected?: boolean
  /** Path to the downloaded chat JSON (Twitch POVs with chat enabled). */
  chatFile?: string
}

export interface StreamerRef {
  handle: string
  platform?: Platform // inferred if omitted
  displayName?: string
}

export interface RosterEntry {
  id: string
  displayName: string
  twitch?: string
  youtube?: string
}

export interface AnalyzeInput {
  anchorUrl: string
  startSec: number // offset into the anchor VOD (its local time)
  endSec: number
  streamers: StreamerRef[]
  includeAnchor: boolean
}

export interface Analysis {
  anchor: AnchorRef
  window: AbsWindow
  povs: POVResult[] // anchor first (if includeAnchor), then each streamer
}

export interface DownloadOptions {
  outDir: string
  quality: Quality
  padSec: number
  filenamePrefix?: string
  /** Also download Twitch chat for each POV, trimmed to the padded window. */
  chat?: boolean
}

export type ProgressPhase = 'queued' | 'resolving' | 'downloading' | 'done' | 'error' | 'skipped'

export interface ProgressEvent {
  handle: string
  platform: Platform
  phase: ProgressPhase
  percent?: number // 0..100
  speed?: string
  eta?: string
  message?: string
}

/** Low-level info about a single VOD (used by providers). */
export interface VodRecord {
  vodId: string
  title: string
  startMs: number
  durationSec: number
  subOnly: boolean
  processing: boolean
}

export class EngineError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}
