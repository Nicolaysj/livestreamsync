// LivestreamSync v0 — headless CLI. Drives the engine end-to-end.
//   tsx cli/index.ts <anchorUrl> <start> <stop|end> --streamers a,b,c [--out DIR] [--quality source|1080|720] [--no-anchor] [--xml] [--chat]

import process from 'node:process'
import { resolve } from 'node:path'
import {
  resolveTools,
  analyze,
  downloadAnalysis,
  exportTimeline,
  parseTimecodeToSec,
  parseTParam,
  secToTimecode,
  type AnalyzeInput,
  type POVResult,
  type Quality,
} from '../engine/src/index.js'

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

// Flags that take a value — both `--out DIR` (what the usage line shows) and
// `--out=DIR` must work. Treating `--out DIR` as a boolean + positional used to
// send downloads to a literal ./true directory and look up the channel "true".
const VALUE_FLAGS = new Set(['streamers', 'out', 'quality'])

function parseArgs(argv: string[]) {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      positionals.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq >= 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1)
      continue
    }
    const k = a.slice(2)
    if (VALUE_FLAGS.has(k)) {
      const v = argv[i + 1]
      if (v == null || v.startsWith('--')) {
        console.error(`Error: --${k} requires a value.`)
        process.exit(2)
      }
      flags[k] = v
      i++
    } else {
      flags[k] = true
    }
  }
  return { positionals, flags }
}

const STATUS_BADGE: Record<string, string> = {
  covered: C.green('✓ covered'),
  partial: C.yellow('◐ partial'),
  gap: C.dim('⊘ no VOD for window'),
  'no-vods': C.dim('⊘ channel has no VODs'),
  'sub-only': C.yellow('🔒 sub-only'),
  processing: C.yellow('⧗ still processing'),
  error: C.red('✕ error'),
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2))
  const [anchorUrl, startRaw, stopRaw] = positionals
  if (!anchorUrl || !startRaw || !stopRaw) {
    console.error('Usage: tsx cli/index.ts <anchorUrl> <start> <stop|end> --streamers a,b,c [--out DIR] [--quality source|1080|720] [--no-anchor] [--xml] [--chat]')
    process.exit(2)
  }

  // The explicit <start> argument always wins; a ?t= carried along in a copied
  // "URL at current time" must not silently override what the user typed.
  const startSec = parseTimecodeToSec(startRaw)
  // "end" = to the end of the VOD (the engine clamps to the anchor's duration).
  const endSec = stopRaw.toLowerCase() === 'end' ? Number.POSITIVE_INFINITY : parseTimecodeToSec(stopRaw)
  const tParam = parseTParam(anchorUrl)
  if (tParam != null && tParam !== startSec) {
    console.error(C.yellow(`Note: anchor URL carries ?t=${secToTimecode(tParam)} — using your explicit start ${secToTimecode(startSec)}.`))
  }
  const streamers = String(flags.streamers || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((handle) => ({ handle }))

  const outDir = resolve(String(flags.out || './livestreamsync-output'))
  const quality = (['source', '1080', '720'].includes(String(flags.quality)) ? flags.quality : 'source') as Quality

  const input: AnalyzeInput = {
    anchorUrl,
    startSec,
    endSec,
    streamers,
    includeAnchor: !flags['no-anchor'],
  }

  const ctx = { tools: resolveTools(), log: (m: string) => console.error(C.dim(`  · ${m}`)) }

  console.log(C.bold('\nLivestreamSync'))
  const windowLabel = Number.isFinite(endSec)
    ? `${secToTimecode(endSec)} (${secToTimecode(endSec - startSec)})`
    : 'end of VOD'
  console.log(C.dim(`Window: ${secToTimecode(startSec)} → ${windowLabel}`))
  process.stdout.write(C.dim('Analyzing… '))

  const analysis = await analyze(input, ctx)
  console.log(C.green('done'))
  console.log(C.dim(`Anchor: ${analysis.anchor.channel} — "${analysis.anchor.title}"\n`))

  for (const p of analysis.povs) {
    const off = p.segment ? C.dim(`@ ${secToTimecode(p.segment.offsetSec)} in their VOD`) : C.dim(p.reason || '')
    console.log(`  ${(STATUS_BADGE[p.status] || p.status).padEnd(28)} ${C.bold(p.displayName.padEnd(18))} ${off}`)
  }

  const selected = analysis.povs.filter((p) => p.selected && p.segment)
  if (flags.dry) {
    console.log(C.dim(`\n(dry run — ${selected.length} clip(s) would download)`))
    return
  }
  if (selected.length === 0) {
    console.log(C.yellow('\nNothing to download.'))
    return
  }

  console.log(C.dim(`\nDownloading ${selected.length} clip(s) → ${outDir}\n`))

  // Ctrl+C must cancel the job properly: the engine spawns yt-dlp/ffmpeg in their
  // own process groups (POSIX), so without an abort they'd survive the CLI and
  // keep downloading. First ^C cancels + cleans up partials; second ^C force-quits.
  const ac = new AbortController()
  process.on('SIGINT', () => {
    if (ac.signal.aborted) process.exit(130)
    console.error(C.yellow('\nCancelling — cleaning up partial files… (Ctrl+C again to force quit)'))
    ac.abort()
  })

  const pct: Record<string, number> = {}
  await downloadAnalysis(analysis, { outDir, quality, padSec: 4, filenamePrefix: 'LivestreamSync', chat: !!flags.chat }, ctx, {
    onProgress: (ev) => {
      if (ev.phase === 'downloading' && ev.percent != null) {
        const prev = pct[ev.handle] ?? -1
        if (ev.percent - prev >= 10 || ev.percent >= 100) {
          pct[ev.handle] = ev.percent
          console.log(C.dim(`  ${ev.handle.padEnd(18)} ${Math.floor(ev.percent)}%${ev.speed ? '  ' + ev.speed : ''}`))
        }
      } else if (ev.phase === 'done') {
        console.log(C.green(`  ${ev.handle.padEnd(18)} ✓ done`))
      } else if (ev.phase === 'error') {
        console.log(C.red(`  ${ev.handle.padEnd(18)} ✕ ${ev.message || 'failed'}`))
      }
    },
  }, ac.signal)

  console.log(C.bold('\nResults:'))
  for (const p of analysis.povs) {
    if (p.outputFile) console.log(`  ${C.green('✓')} ${p.displayName.padEnd(18)} ${C.dim(p.outputFile)} ${C.dim(fmtBytes(p.fileBytes))}${p.chatFile ? C.cyan(' +chat') : ''}`)
    else if (p.selected) console.log(`  ${C.red('✕')} ${p.displayName.padEnd(18)} ${C.dim(p.reason || '')}`)
  }

  if (flags.xml) {
    const xmlPath = await exportTimeline(analysis, { outDir })
    console.log(C.cyan(`\nTimeline: ${xmlPath}`))
  }
  console.log('')
}

function fmtBytes(n?: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return ''
  const mb = n / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

main().catch((err) => {
  console.error(C.red(`\nError: ${err instanceof Error ? err.message : String(err)}`))
  process.exit(1)
})
