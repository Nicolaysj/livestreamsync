// Downloads the yt-dlp + ffmpeg Windows binaries into ./tools/ so electron-builder can
// bundle them via extraResources. Run before packaging: `node build/fetch-tools.mjs`.
// At runtime the app resolves them from <resources>/tools (see engine/src/tools.ts).
import { mkdir, writeFile, rm, readdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const TOOLS = join(process.cwd(), 'tools')
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_ZIP = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

async function download(url, dest) {
  process.stdout.write(`  fetching ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', ...opts })
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(p, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name) {
      return p
    }
  }
  return null
}

async function main() {
  await mkdir(TOOLS, { recursive: true })

  if (!existsSync(join(TOOLS, 'yt-dlp.exe'))) {
    await download(YTDLP_URL, join(TOOLS, 'yt-dlp.exe'))
  }

  if (!existsSync(join(TOOLS, 'ffmpeg.exe'))) {
    const zip = join(TOOLS, '_ffmpeg.zip')
    const tmp = join(TOOLS, '_ffmpeg')
    await download(FFMPEG_ZIP, zip)
    await mkdir(tmp, { recursive: true })
    // Windows 10+ ships bsdtar, which extracts .zip.
    await exec('tar', ['-xf', zip, '-C', tmp])
    const ff = await findFile(tmp, 'ffmpeg.exe')
    if (!ff) throw new Error('ffmpeg.exe not found in archive')
    await copyFile(ff, join(TOOLS, 'ffmpeg.exe'))
    await rm(zip, { force: true })
    await rm(tmp, { recursive: true, force: true })
  }

  for (const f of ['yt-dlp.exe', 'ffmpeg.exe']) {
    const s = await stat(join(TOOLS, f))
    console.log(`  ✓ tools/${f} (${(s.size / 1024 / 1024).toFixed(1)} MB)`)
  }
}

main().catch((e) => {
  console.error('fetch-tools failed:', e.message)
  process.exit(1)
})
