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
  analyze: 'livestreamsync:analyze',
  download: 'livestreamsync:download',
  cancel: 'livestreamsync:cancel',
  exportTimeline: 'livestreamsync:export',
  pickFolder: 'livestreamsync:pickFolder',
  openFolder: 'livestreamsync:openFolder',
  revealFile: 'livestreamsync:revealFile',
  getRoster: 'livestreamsync:getRoster',
  saveRoster: 'livestreamsync:saveRoster',
  getDefaults: 'livestreamsync:getDefaults',
  checkTools: 'livestreamsync:checkTools',
  progress: 'livestreamsync:progress',
  updateStatus: 'livestreamsync:update:status',
  updateDownload: 'livestreamsync:update:download',
  updateInstall: 'livestreamsync:update:install',
  winMinimize: 'livestreamsync:win:minimize',
  winMaximize: 'livestreamsync:win:maximize',
  winClose: 'livestreamsync:win:close',
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

/** In-app auto-update lifecycle, pushed from main → renderer. */
export type UpdateStatus =
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

/** The API surfaced on `window.livestreamsync` by the preload bridge. */
export interface LivestreamSyncApi {
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
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  downloadUpdate(): void
  installUpdate(): void
  minimize(): void
  toggleMaximize(): void
  close(): void
}
