import { app, BrowserWindow, ipcMain, dialog, shell, session, Notification } from 'electron'
import electronUpdater from 'electron-updater'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, copyFile, chmod, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolveTools, resetToolCache, isAllowedVodUrl } from '../engine/src/index.js'
import { analyze, downloadAnalysis, exportTimeline } from '../engine/src/index.js'
import type { AnalyzeInput, ProviderContext, RosterEntry } from '../engine/src/index.js'
import { CH, type DownloadRequest, type ExportRequest, type UpdateStatus } from '../shared/ipc.js'

const { autoUpdater } = electronUpdater

// This file is bundled to CommonJS by esbuild, so __dirname is the native CJS global
// (resolves to dist-electron/). Do NOT compute it from import.meta.url — esbuild leaves
// that undefined in CJS output, which crashes the main process on load.
declare const __dirname: string
const isDev = !!process.env.VITE_DEV_SERVER_URL
const isMac = process.platform === 'darwin'

// The yt-dlp binary name differs by OS (no extension on POSIX).
const YTDLP_BIN = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'

// electron-updater (Squirrel.Mac) validates the app's code signature, so the in-app
// download+install path can't work on our unsigned macOS build — only enable that on Windows.
// macOS instead does a signing-free GitHub version *check* and notifies the user, who then
// downloads the new build manually (see checkMacUpdate + the update IPC handlers).
const UPDATER_ENABLED = !isMac
const RELEASES_URL = 'https://github.com/Nicolaysj/livestreamsync/releases/latest'
const RELEASES_API = 'https://api.github.com/repos/Nicolaysj/livestreamsync/releases/latest'

// Directories the user has explicitly chosen (folder picker / default / download target).
// shell.openPath / showItemInFolder are only allowed for paths inside one of these — a
// compromised renderer cannot open arbitrary files/programs on the host.
const allowedDirs = new Set<string>()
function allowDir(dir: unknown): void {
  if (typeof dir === 'string' && dir) allowedDirs.add(resolve(dir))
}
function isPathAllowed(p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false
  // Windows paths are case-insensitive; a renderer echoing "c:\users\…" for an
  // allowed "C:\Users\…" must not get a spurious "folder is not permitted".
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
  const rp = norm(resolve(p))
  for (const dir of allowedDirs) {
    const d = norm(dir)
    if (rp === d || rp.startsWith(d + sep)) return true
  }
  return false
}

let mainWindow: BrowserWindow | null = null
let currentAbort: AbortController | null = null

function toolsDir(): string | undefined {
  return app.isPackaged ? join(process.resourcesPath, 'tools') : undefined
}

function ctx(): ProviderContext {
  return { tools: resolveTools(toolsDir()), log: (m) => isDev && console.error('[engine]', m) }
}

function rosterPath(): string {
  return join(app.getPath('userData'), 'roster.json')
}

// ---- yt-dlp self-update -------------------------------------------------------
// YouTube changes break older yt-dlp often, so copy the bundled binary to a writable
// per-user location, point the engine at it, and keep it current with `yt-dlp -U`
// (throttled to once a day). Dev uses whatever yt-dlp is on PATH.
const ONE_DAY = 24 * 60 * 60 * 1000

async function ensureYtDlpFresh(): Promise<void> {
  if (!app.isPackaged) return
  const userTools = join(app.getPath('userData'), 'tools')
  const dest = join(userTools, YTDLP_BIN)
  const bundled = join(process.resourcesPath, 'tools', YTDLP_BIN)
  try {
    await mkdir(userTools, { recursive: true })
    if (!existsSync(dest) && existsSync(bundled)) await copyFile(bundled, dest)
    if (existsSync(dest)) {
      // copyFile preserves mode, but extraResources packaging and the `-U` rewrite can drop
      // the +x bit — re-assert it on POSIX so spawn never fails with EACCES.
      if (process.platform !== 'win32') await chmod(dest, 0o755).catch(() => {})
      process.env.LIVESTREAMSYNC_YTDLP = dest // engine resolves this first (tools.ts)
      resetToolCache()
    }
  } catch (e) {
    if (isDev) console.error('[yt-dlp] setup failed', e)
    return
  }
  void selfUpdateYtDlp(userTools, dest)
}

async function selfUpdateYtDlp(userTools: string, dest: string): Promise<void> {
  const stamp = join(userTools, '.yt-dlp-checked')
  const last = await readFile(stamp, 'utf8').then((t) => Number(t) || 0).catch(() => 0)
  if (Date.now() - last < ONE_DAY) return
  await writeFile(stamp, String(Date.now()), 'utf8').catch(() => {})
  await new Promise<void>((res) => {
    const child = spawn(dest, ['-U'], { windowsHide: true })
    const kill = setTimeout(() => { child.kill(); res() }, 90_000)
    child.on('error', () => { clearTimeout(kill); res() })
    child.on('close', () => { clearTimeout(kill); res() })
  })
  // yt-dlp rewrites its own binary on update, which can reset the mode — re-assert +x.
  if (process.platform !== 'win32') await chmod(dest, 0o755).catch(() => {})
}

// ---- macOS update check (signing-free, notify-only) ---------------------------
// We can't auto-install on an unsigned mac, but we CAN ask GitHub whether a newer release
// exists and nudge the user to grab it. Pure version comparison, no Squirrel involved.
function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) => {
    const [core, ...rest] = v.replace(/^v/, '').split('-')
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: rest.join('-') }
  }
  const r = parse(remote)
  const l = parse(local)
  for (let i = 0; i < Math.max(r.nums.length, l.nums.length); i++) {
    const a = r.nums[i] ?? 0
    const b = l.nums[i] ?? 0
    if (a !== b) return a > b
  }
  // Same core version: a prerelease predates its final release (0.3.0-rc1 < 0.3.0).
  return !r.pre && !!l.pre
}

// Show a native OS notification at most once per new version (stamped in userData), so we
// nudge but never nag. The persistent reminder is the dot in the title-bar updates menu.
async function notifyNewVersion(version: string): Promise<void> {
  if (!Notification.isSupported()) return
  const stamp = join(app.getPath('userData'), '.update-notified')
  const last = await readFile(stamp, 'utf8').catch(() => '')
  if (last.trim() === version) return
  await writeFile(stamp, version, 'utf8').catch(() => {})
  const n = new Notification({
    title: `LivestreamSync ${version} is available`,
    body: 'Click to download the new version from GitHub.',
  })
  n.on('click', () => void shell.openExternal(RELEASES_URL))
  n.show()
}

/**
 * Ask GitHub for the latest release and tell the renderer whether one is newer than us.
 * `fromUser` = a manual "Check for updates" click (show the checking/error states);
 * on launch we stay quiet on failure and only surface a genuine new version.
 */
async function checkMacUpdate(win: BrowserWindow | null, fromUser: boolean): Promise<void> {
  const send = (s: UpdateStatus) => {
    if (win && !win.isDestroyed()) win.webContents.send(CH.updateStatus, s)
  }
  if (fromUser) send({ state: 'checking' })
  let latest = ''
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LivestreamSync-Updater' },
      // A stalled connection (captive portal, hung proxy) must not leave the
      // updates menu stuck on "checking" forever.
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return send({ state: 'none' }) // no releases published yet
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string }
    latest = (data.tag_name || '').replace(/^v/, '')
  } catch (e) {
    if (fromUser) send({ state: 'error', message: 'Couldn’t reach GitHub to check for updates.' })
    else if (isDev) console.error('[update:mac]', e)
    return
  }
  if (latest && isNewerVersion(latest, app.getVersion())) {
    send({ state: 'available', version: latest })
    if (!fromUser) void notifyNewVersion(latest) // one-time native nudge on launch
  } else {
    send({ state: 'none' })
  }
}

// ---- in-app auto-update (electron-updater) ------------------------------------
// "Notify, install on click": check on launch, tell the renderer when an update is
// available; the user clicks to download, then clicks again to restart & install.
function setupAutoUpdate(win: BrowserWindow): void {
  if (!app.isPackaged) return
  if (isMac) {
    // Unsigned mac: no in-app install, but check GitHub on launch and notify (dot + a
    // one-time native notification) so users know when to grab the new build.
    setTimeout(() => void checkMacUpdate(mainWindow ?? win, false), 3000)
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  // Send to the *current* window, not the one captured at setup — on macOS the
  // window can be closed and recreated via the Dock while the app keeps running.
  const send = (s: UpdateStatus) => {
    const w = mainWindow
    if (w && !w.isDestroyed()) w.webContents.send(CH.updateStatus, s)
  }
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'downloaded', version: i.version }))
  autoUpdater.on('error', (e) => send({ state: 'error', message: e instanceof Error ? e.message : 'Update failed' }))
  // Give the renderer a moment to subscribe before the first check resolves.
  setTimeout(() => void autoUpdater.checkForUpdates().catch((e) => isDev && console.error('[update]', e)), 3000)
}

const CSP_PROD =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self' data:; media-src 'self'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"
const CSP_DEV =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: http://localhost:5173; " +
  "font-src 'self' data:; media-src 'self'; object-src 'none'"

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 800,
    minWidth: 900,
    minHeight: 660,
    show: false,
    backgroundColor: '#0a0a0f',
    // macOS keeps its native traffic lights ('hiddenInset' hides the OS title bar but not the
    // controls); Windows is fully frameless and draws its own controls in the custom TitleBar.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { frame: false as const, titleBarStyle: 'hidden' as const }),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Lock navigation: never let the renderer navigate away or open new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?(twitch\.tv|youtube\.com|youtu\.be)\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  const distUrl = pathToFileURL(join(__dirname, '../dist/')).href
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL
    if (dev && url.startsWith(dev)) return
    if (url.startsWith(distUrl)) return // only the app's own bundle, not any file://
    e.preventDefault()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Single instance: two copies would race on userData — worst case one instance
// rewrites tools/yt-dlp.exe via `-U` while the other is executing it, and both
// clobber roster.json. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? CSP_DEV : CSP_PROD],
      },
    })
  })

  registerIpc()
  createWindow()
  void ensureYtDlpFresh()
  if (mainWindow) setupAutoUpdate(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Abort any in-flight job on quit. Without this the detached yt-dlp/ffmpeg trees
// outlive the app and keep downloading (and holding partial files) indefinitely —
// killTree signals process groups on POSIX and hands off to taskkill on Windows,
// both of which complete even as we exit.
app.on('before-quit', () => {
  currentAbort?.abort()
})

function registerIpc() {
  ipcMain.handle(CH.analyze, async (_e, input: AnalyzeInput) => {
    return analyze(input, ctx())
  })

  ipcMain.handle(CH.download, async (e, req: DownloadRequest) => {
    // SECURITY: the analysis object round-tripped through the (untrusted) renderer.
    // Re-validate every segment URL before it can reach yt-dlp's argv.
    for (const p of req.analysis?.povs ?? []) {
      if (p.selected && p.segment && (p.status === 'covered' || p.status === 'partial')) {
        if (!isAllowedVodUrl(p.segment.url, p.segment.platform)) {
          throw new Error('Refusing to download: an unexpected URL was supplied.')
        }
      }
    }
    // SECURITY: only download into a folder the user already chose (picker / default).
    // Do NOT add the renderer-supplied path to the allow-list — that would let a
    // compromised renderer poison it and later open arbitrary files via shell.openPath.
    if (!isPathAllowed(req.options?.outDir)) throw new Error('Download folder is not permitted.')

    const ac = new AbortController()
    currentAbort?.abort()
    currentAbort = ac
    const sender = e.sender
    try {
      return await downloadAnalysis(
        req.analysis,
        req.options,
        ctx(),
        { onProgress: (ev) => { if (!sender.isDestroyed()) sender.send(CH.progress, ev) } },
        ac.signal,
      )
    } finally {
      if (currentAbort === ac) currentAbort = null
    }
  })

  ipcMain.handle(CH.cancel, async () => {
    currentAbort?.abort()
  })

  ipcMain.handle(CH.exportTimeline, async (_e, req: ExportRequest) => {
    if (!isPathAllowed(req.outDir)) throw new Error('Export folder is not permitted.')
    return exportTimeline(req.analysis, { outDir: req.outDir })
  })

  ipcMain.handle(CH.pickFolder, async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    const dir = r.canceled ? null : r.filePaths[0] ?? null
    if (dir) allowDir(dir)
    return dir
  })

  ipcMain.handle(CH.openFolder, async (_e, p: unknown) => {
    if (!isPathAllowed(p)) return
    const rp = resolve(p)
    // Only ever open a directory — never let shell.openPath launch a file (.exe/.lnk/…).
    const { statSync } = await import('node:fs')
    try {
      if (!statSync(rp).isDirectory()) return
    } catch {
      return
    }
    await shell.openPath(rp)
  })

  ipcMain.handle(CH.revealFile, async (_e, p: unknown) => {
    if (isPathAllowed(p)) shell.showItemInFolder(resolve(p))
  })

  // Roster entries cross the trust boundary from the renderer: shape-check every
  // field (and cap sizes) so a compromised renderer can't persist multi-GB junk,
  // and so a torn file never round-trips back into the UI.
  const asRosterEntry = (v: unknown): RosterEntry | null => {
    if (typeof v !== 'object' || v === null) return null
    const o = v as Record<string, unknown>
    const str = (x: unknown, max: number) => (typeof x === 'string' && x.length <= max ? x : undefined)
    const id = str(o.id, 200)
    const displayName = str(o.displayName, 200)
    if (!id || !displayName) return null
    const entry: RosterEntry = { id, displayName }
    const twitch = str(o.twitch, 100)
    const youtube = str(o.youtube, 100)
    if (twitch) entry.twitch = twitch
    if (youtube) entry.youtube = youtube
    return entry
  }

  ipcMain.handle(CH.getRoster, async (): Promise<RosterEntry[]> => {
    try {
      const txt = await readFile(rosterPath(), 'utf8')
      const data = JSON.parse(txt)
      if (!Array.isArray(data)) return []
      return data.map(asRosterEntry).filter((e): e is RosterEntry => e !== null)
    } catch {
      return []
    }
  })

  ipcMain.handle(CH.saveRoster, async (_e, roster: unknown) => {
    if (!Array.isArray(roster)) return
    const entries = roster.slice(0, 200).map(asRosterEntry).filter((e): e is RosterEntry => e !== null)
    await mkdir(app.getPath('userData'), { recursive: true })
    // Write-then-rename so a crash mid-write can't leave truncated JSON that
    // silently wipes the user's roster on the next read.
    const tmp = `${rosterPath()}.tmp`
    await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8')
    await rename(tmp, rosterPath())
  })

  ipcMain.handle(CH.getDefaults, async () => {
    const outDir = join(app.getPath('videos'), 'LivestreamSync')
    allowDir(outDir)
    return { outDir }
  })

  ipcMain.handle(CH.checkTools, async () => {
    const { existsSync } = await import('node:fs')
    const t = resolveTools(toolsDir())
    // resolveTools returns an absolute path when found, else a bare command name.
    const ok = (p: string) => (p.includes('/') || p.includes('\\')) && existsSync(p)
    return { ytDlp: ok(t.ytDlp), ffmpeg: ok(t.ffmpeg) }
  })

  ipcMain.handle(CH.getVersion, () => app.getVersion())
  ipcMain.on(CH.updateCheck, (e) => {
    if (isMac) {
      // Signing-free GitHub version check; surfaces "available" (with the version) or "none".
      void checkMacUpdate(mainWindow, true)
    } else if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch((err) => isDev && console.error('[update]', err))
    } else {
      // Dev build can't self-update; tell the renderer it's "up to date" so the menu resolves.
      e.sender.send(CH.updateStatus, { state: 'none' } satisfies UpdateStatus)
    }
  })
  ipcMain.on(CH.updateDownload, () => {
    // On mac the "Download" action just opens the releases page (manual install); on Windows
    // it triggers the real electron-updater download.
    if (isMac) void shell.openExternal(RELEASES_URL)
    else if (app.isPackaged) autoUpdater.downloadUpdate().catch((e) => isDev && console.error('[update]', e))
  })
  ipcMain.on(CH.updateInstall, () => {
    if (UPDATER_ENABLED && app.isPackaged) autoUpdater.quitAndInstall()
  })

  ipcMain.on(CH.winMinimize, () => mainWindow?.minimize())
  ipcMain.on(CH.winMaximize, () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on(CH.winClose, () => mainWindow?.close())
}
