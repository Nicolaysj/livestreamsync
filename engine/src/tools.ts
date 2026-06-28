// Locating the yt-dlp and ffmpeg binaries.
// Resolution order: explicit env override → bundled tools dir → PATH lookup.
// Returning an absolute path lets us spawn WITHOUT a shell (see exec.ts).

import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import process from 'node:process'

export interface Tools {
  ytDlp: string
  ffmpeg: string
}

const isWin = process.platform === 'win32'

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

/** which-like resolver. Returns an absolute path or null. Never uses a shell. */
function findOnPath(name: string): string | null {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, isWin ? name + ext : name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveOne(base: string, envVar: string, bundledDir: string | undefined): string {
  const override = process.env[envVar]
  if (override && existsSync(override)) return override

  if (bundledDir) {
    const bundled = join(bundledDir, exe(base))
    if (existsSync(bundled)) return bundled
  }

  const onPath = findOnPath(base)
  if (onPath) return onPath

  // Fall back to the bare name; spawn may still resolve it. Surfaces a clear error if not.
  return exe(base)
}

let cached: Tools | null = null

/**
 * Resolve tool paths. `bundledDir` is where a packaged app keeps its binaries
 * (e.g. <resources>/tools); pass it from the Electron main process.
 */
export function resolveTools(bundledDir?: string): Tools {
  if (cached) return cached
  cached = {
    ytDlp: resolveOne('yt-dlp', 'LIVESTREAMSYNC_YTDLP', bundledDir),
    ffmpeg: resolveOne('ffmpeg', 'LIVESTREAMSYNC_FFMPEG', bundledDir),
  }
  return cached
}

/** For tests / re-resolution after installing tools. */
export function resetToolCache(): void {
  cached = null
}
