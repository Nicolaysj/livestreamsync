// Downloads the yt-dlp + ffmpeg Windows binaries into ./tools/ so electron-builder can
// bundle them (extraResources). Run before packaging: `node build/fetch-tools.mjs`.
// Every binary is verified against the publisher's own SHA-256 checksum before use.
import { mkdir, writeFile, rm, readdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'

const TOOLS = join(process.cwd(), 'tools')

// yt-dlp pinned to a specific release (also auto-updates at runtime). Verified against
// the release's official SHA2-256SUMS.
const YTDLP_TAG = '2026.02.04'
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/yt-dlp.exe`
const YTDLP_SUMS = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/SHA2-256SUMS`

// ffmpeg from gyan.dev, verified against its published .sha256 sidecar.
const FFMPEG_ZIP = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const FFMPEG_SHA = FFMPEG_ZIP + '.sha256'

async function getBuffer(url) {
  process.stdout.write(`  fetching ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}
const getText = async (url) => (await getBuffer(url)).toString('utf8')

function verify(buf, expectedHex, name) {
  const got = createHash('sha256').update(buf).digest('hex')
  if (got.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${name}: expected ${expectedHex}, got ${got}`)
  }
  process.stdout.write(`  ✓ verified ${name}\n`)
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
    const [bin, sums] = await Promise.all([getBuffer(YTDLP_URL), getText(YTDLP_SUMS)])
    const line = sums.split('\n').find((l) => /\byt-dlp\.exe\b/.test(l))
    if (!line) throw new Error('yt-dlp.exe not listed in SHA2-256SUMS')
    verify(bin, line.trim().split(/\s+/)[0], 'yt-dlp.exe')
    await writeFile(join(TOOLS, 'yt-dlp.exe'), bin)
  }

  if (!existsSync(join(TOOLS, 'ffmpeg.exe'))) {
    const [zipBuf, shaText] = await Promise.all([getBuffer(FFMPEG_ZIP), getText(FFMPEG_SHA)])
    verify(zipBuf, shaText.trim().split(/\s+/)[0], 'ffmpeg.zip')
    const zip = join(TOOLS, '_ffmpeg.zip')
    const tmp = join(TOOLS, '_ffmpeg')
    await writeFile(zip, zipBuf)
    await mkdir(tmp, { recursive: true })
    await exec('tar', ['-xf', zip, '-C', tmp]) // Windows 10+ bsdtar extracts .zip
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
