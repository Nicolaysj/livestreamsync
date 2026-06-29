// Downloads the yt-dlp + ffmpeg binaries into ./tools/ so electron-builder can bundle
// them (extraResources). Run before packaging: `node build/fetch-tools.mjs`.
// Every binary is verified against the publisher's own SHA-256 checksum before use.
//
// Cross-platform:
//   • Windows → yt-dlp.exe + BtbN static ffmpeg.exe/ffprobe.exe (system bsdtar extracts the .zip).
//   • macOS   → universal `yt-dlp_macos` (runs natively on Apple Silicon, supports -U) +
//               static arm64 ffmpeg/ffprobe from Martin Riedl's build server.
// macOS binaries are downloaded without the executable bit, so we chmod 0o755 after write.
import { mkdir, writeFile, rm, readdir, copyFile, stat, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'

const TOOLS = join(process.cwd(), 'tools')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
if (!isWin && !isMac) {
  console.error(`fetch-tools: unsupported platform "${process.platform}" — Windows and macOS only.`)
  process.exit(1)
}

// Windows: use the system bsdtar by absolute path: it extracts .zip and handles drive
// paths. (Git Bash's GNU `tar` on PATH cannot read zips and misreads "C:\…".)
// macOS: the system `tar` (bsdtar) on PATH extracts .zip fine.
const SYSTAR = isWin ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

// yt-dlp pinned to a recent release (the app then self-updates it at runtime — YouTube
// changes break older yt-dlp often). Verified against the release's official SHA2-256SUMS.
const YTDLP_TAG = '2026.06.09'
// macOS uses the universal `yt-dlp_macos` asset; we write it out as a bare `yt-dlp` so the
// engine's tool resolver (which expects the bare name on POSIX) finds it.
const YTDLP_ASSET = isWin ? 'yt-dlp.exe' : 'yt-dlp_macos'
const YTDLP_OUT = isWin ? 'yt-dlp.exe' : 'yt-dlp'
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/${YTDLP_ASSET}`
const YTDLP_SUMS = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/SHA2-256SUMS`

// ffmpeg for Windows from BtbN/FFmpeg-Builds (GitHub CDN — fast & reliable; gyan.dev stalls).
// Static "win64-gpl" build = self-contained ffmpeg.exe + ffprobe.exe, no DLLs. Pinned to a
// dated autobuild and verified against a hardcoded SHA-256 (BtbN ships no .sha256 sidecar).
const FFMPEG_WIN_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-28-13-24/ffmpeg-N-125331-g87bd15dc3c-win64-gpl.zip'
const FFMPEG_WIN_SHA = '486746b729340a189e867895c348b0240c8f37edf8c9e0f9d648361a951973a5'

// macOS: Martin Riedl's build server — static arm64 Mach-O with a per-file .sha256 sidecar.
// Pinned to a dated build for reproducibility (their /redirect/latest is occasionally flaky).
const MR_VER = '1778761665_8.1.1' // ffmpeg 8.1.1, macOS arm64
const MR_BASE = `https://ffmpeg.martin-riedl.de/download/macos/arm64/${MR_VER}`

// Retry with backoff + a per-attempt timeout, so a stalled/flaky host (gyan.dev was the
// classic offender) aborts and retries instead of hanging the whole CI job forever.
async function getBuffer(url, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 120_000)
    try {
      process.stdout.write(`  fetching ${url}${i > 1 ? ` (attempt ${i}/${attempts})` : ''}\n`)
      const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${url} (${lastErr?.message || lastErr})`)
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

// ---- Windows -----------------------------------------------------------------
async function fetchWindows() {
  if (!existsSync(join(TOOLS, 'yt-dlp.exe'))) {
    const [bin, sums] = await Promise.all([getBuffer(YTDLP_URL), getText(YTDLP_SUMS)])
    const line = sums.split('\n').find((l) => /\byt-dlp\.exe\b/.test(l))
    if (!line) throw new Error('yt-dlp.exe not listed in SHA2-256SUMS')
    verify(bin, line.trim().split(/\s+/)[0], 'yt-dlp.exe')
    await writeFile(join(TOOLS, 'yt-dlp.exe'), bin)
  }

  if (!existsSync(join(TOOLS, 'ffmpeg.exe')) || !existsSync(join(TOOLS, 'ffprobe.exe'))) {
    const zipBuf = await getBuffer(FFMPEG_WIN_URL)
    verify(zipBuf, FFMPEG_WIN_SHA, 'ffmpeg-win64-gpl.zip')
    const zip = join(TOOLS, '_ffmpeg.zip')
    const tmp = join(TOOLS, '_ffmpeg')
    await writeFile(zip, zipBuf)
    await mkdir(tmp, { recursive: true })
    // Relative names with cwd=TOOLS so tar doesn't read "C:\…" as a remote host:path.
    await exec(SYSTAR, ['-xf', '_ffmpeg.zip', '-C', '_ffmpeg'], { cwd: TOOLS }) // Win10+ bsdtar extracts .zip
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const found = await findFile(tmp, name)
      if (!found) throw new Error(`${name} not found in archive`)
      await copyFile(found, join(TOOLS, name))
    }
    await rm(zip, { force: true })
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---- macOS -------------------------------------------------------------------
async function fetchMac() {
  // yt-dlp_macos -> tools/yt-dlp
  const ytOut = join(TOOLS, YTDLP_OUT)
  if (!existsSync(ytOut)) {
    const [bin, sums] = await Promise.all([getBuffer(YTDLP_URL), getText(YTDLP_SUMS)])
    // Match the exact asset name by its second field. A regex/substring match would also
    // hit `yt-dlp_macos.zip`, whose hash differs — that would verify against the wrong line.
    const line = sums.split('\n').find((l) => l.trim().split(/\s+/)[1] === YTDLP_ASSET)
    if (!line) throw new Error(`${YTDLP_ASSET} not listed in SHA2-256SUMS`)
    verify(bin, line.trim().split(/\s+/)[0], YTDLP_ASSET)
    await writeFile(ytOut, bin)
    await chmod(ytOut, 0o755) // GitHub release downloads lack the +x bit
  }

  // ffmpeg + ffprobe — yt-dlp needs ffprobe beside ffmpeg to mux --download-sections output.
  for (const name of ['ffmpeg', 'ffprobe']) {
    const out = join(TOOLS, name)
    if (existsSync(out)) continue
    const [zipBuf, shaText] = await Promise.all([
      getBuffer(`${MR_BASE}/${name}.zip`),
      getText(`${MR_BASE}/${name}.zip.sha256`),
    ])
    verify(zipBuf, shaText.trim().split(/\s+/)[0], `${name}.zip`)
    const zip = join(TOOLS, `_${name}.zip`)
    const tmp = join(TOOLS, `_${name}`)
    await writeFile(zip, zipBuf)
    await mkdir(tmp, { recursive: true })
    await exec(SYSTAR, ['-xf', `_${name}.zip`, '-C', `_${name}`], { cwd: TOOLS })
    const bin = await findFile(tmp, name) // each zip holds a single bare binary at the root
    if (!bin) throw new Error(`${name} not found in archive`)
    await copyFile(bin, out)
    await chmod(out, 0o755)
    await rm(zip, { force: true })
    await rm(tmp, { recursive: true, force: true })
  }
}

async function main() {
  await mkdir(TOOLS, { recursive: true })

  if (isWin) await fetchWindows()
  else await fetchMac()

  const expected = isWin ? ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe'] : ['yt-dlp', 'ffmpeg', 'ffprobe']
  for (const f of expected) {
    const s = await stat(join(TOOLS, f))
    console.log(`  ✓ tools/${f} (${(s.size / 1024 / 1024).toFixed(1)} MB)`)
  }
}

main().catch((e) => {
  console.error('fetch-tools failed:', e.message)
  process.exit(1)
})
