import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolveTools, isAllowedVodUrl } from '../engine/src/index.js'
import { analyze, downloadAnalysis, exportTimeline } from '../engine/src/index.js'
import type { AnalyzeInput, ProviderContext, RosterEntry } from '../engine/src/index.js'
import { CH, type DownloadRequest, type ExportRequest } from '../shared/ipc.js'

// This file is bundled to CommonJS by esbuild, so __dirname is the native CJS global
// (resolves to dist-electron/). Do NOT compute it from import.meta.url — esbuild leaves
// that undefined in CJS output, which crashes the main process on load.
declare const __dirname: string
const isDev = !!process.env.VITE_DEV_SERVER_URL

// Directories the user has explicitly chosen (folder picker / default / download target).
// shell.openPath / showItemInFolder are only allowed for paths inside one of these — a
// compromised renderer cannot open arbitrary files/programs on the host.
const allowedDirs = new Set<string>()
function allowDir(dir: unknown): void {
  if (typeof dir === 'string' && dir) allowedDirs.add(resolve(dir))
}
function isPathAllowed(p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false
  const rp = resolve(p)
  for (const dir of allowedDirs) {
    if (rp === dir || rp.startsWith(dir + sep)) return true
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
    frame: false,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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

  ipcMain.handle(CH.getRoster, async (): Promise<RosterEntry[]> => {
    try {
      const txt = await readFile(rosterPath(), 'utf8')
      const data = JSON.parse(txt)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  })

  ipcMain.handle(CH.saveRoster, async (_e, roster: unknown) => {
    if (!Array.isArray(roster)) return
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(rosterPath(), JSON.stringify(roster, null, 2), 'utf8')
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

  ipcMain.on(CH.winMinimize, () => mainWindow?.minimize())
  ipcMain.on(CH.winMaximize, () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on(CH.winClose, () => mainWindow?.close())
}
