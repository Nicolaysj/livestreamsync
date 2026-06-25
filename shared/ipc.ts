// Shared IPC contract between the Electron main process and the renderer.
// Type-only imports from the engine — no engine runtime code reaches the renderer.

import type {
  Analysis,
  AnalyzeInput,
  DownloadOptions,
  POVResult,
  ProgressEvent,
  RosterEntry,
} from '../engine/src/types'

export const CH = {
  analyze: 'povsync:analyze',
  download: 'povsync:download',
  cancel: 'povsync:cancel',
  exportTimeline: 'povsync:export',
  pickFolder: 'povsync:pickFolder',
  openFolder: 'povsync:openFolder',
  revealFile: 'povsync:revealFile',
  getRoster: 'povsync:getRoster',
  saveRoster: 'povsync:saveRoster',
  getDefaults: 'povsync:getDefaults',
  checkTools: 'povsync:checkTools',
  progress: 'povsync:progress',
  winMinimize: 'povsync:win:minimize',
  winMaximize: 'povsync:win:maximize',
  winClose: 'povsync:win:close',
} as const

export interface DownloadRequest {
  analysis: Analysis
  options: DownloadOptions
}

export interface ExportRequest {
  analysis: Analysis
  outDir: string
}

export interface Defaults {
  outDir: string
}

export interface ToolStatus {
  ytDlp: boolean
  ffmpeg: boolean
}

/** The API surfaced on `window.povsync` by the preload bridge. */
export interface PovsyncApi {
  analyze(input: AnalyzeInput): Promise<Analysis>
  download(req: DownloadRequest): Promise<POVResult[]>
  cancel(): Promise<void>
  exportTimeline(req: ExportRequest): Promise<string>
  pickFolder(): Promise<string | null>
  openFolder(path: string): Promise<void>
  revealFile(path: string): Promise<void>
  getRoster(): Promise<RosterEntry[]>
  saveRoster(roster: RosterEntry[]): Promise<void>
  getDefaults(): Promise<Defaults>
  checkTools(): Promise<ToolStatus>
  onProgress(cb: (ev: ProgressEvent) => void): () => void
  minimize(): void
  toggleMaximize(): void
  close(): void
}
