import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Analysis, POVResult, ProgressEvent, RosterEntry } from '../engine/src/types'
import { TitleBar } from './components/TitleBar'
import { Setup, type SetupForm } from './components/Setup'
import { Review } from './components/Review'
import { Progress } from './components/Progress'
import { api } from './lib/api'
import { parseTimecodeToSec } from './lib/format'

type Stage = 'setup' | 'review' | 'downloading' | 'done'

const DEFAULT_FORM: SetupForm = {
  anchorUrl: '',
  start: '',
  stop: '',
  handles: [],
  outDir: '',
  quality: 'source',
  includeAnchor: true,
  exportXml: true,
  chat: false,
}

export default function App() {
  const [stage, setStage] = useState<Stage>('setup')
  const [form, setForm] = useState<SetupForm>(DEFAULT_FORM)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [toolWarning, setToolWarning] = useState<string | undefined>()
  const [progress, setProgress] = useState<Record<string, ProgressEvent>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>()
  const [xmlPath, setXmlPath] = useState<string | undefined>()
  const analysisRef = useRef<Analysis | null>(null)
  analysisRef.current = analysis
  const jobIdRef = useRef(0)

  useEffect(() => {
    api.getRoster().then(setRoster).catch(() => {})
    api.getDefaults().then((d) => setForm((f) => (f.outDir ? f : { ...f, outDir: d.outDir }))).catch(() => {})
    api
      .checkTools()
      .then((t) => {
        if (!t.ytDlp || !t.ffmpeg) {
          const missing = [!t.ytDlp && 'yt-dlp', !t.ffmpeg && 'ffmpeg'].filter(Boolean).join(' and ')
          setToolWarning(
            `${missing} could not be found, so downloads will fail. Antivirus sometimes quarantines yt-dlp — try restoring it or reinstalling LivestreamSync.`,
          )
        }
      })
      .catch(() => {})
    const off = api.onProgress((ev) =>
      setProgress((prev) => {
        const key = `${ev.platform}:${ev.handle}`
        // Error/done events may arrive without a percent — keep the last known
        // value so a clip that dies at 60% doesn't visually reset to 0.
        return { ...prev, [key]: { ...ev, percent: ev.percent ?? prev[key]?.percent } }
      }),
    )
    return off
  }, [])

  const runAnalyze = async () => {
    setError(undefined)
    let startSec: number
    let endSec: number
    try {
      startSec = parseTimecodeToSec(form.start)
      // Blank stop = "to the end of the VOD"; the engine clamps Infinity to the
      // anchor's real duration (and errors if the VOD doesn't report one).
      endSec = form.stop.trim() ? parseTimecodeToSec(form.stop) : Number.POSITIVE_INFINITY
    } catch {
      setError('Check your start/stop times — use HH:MM:SS.')
      return
    }
    if (!(endSec > startSec)) {
      setError('Stop time must be after start time.')
      return
    }
    setAnalyzing(true)
    try {
      const result = await api.analyze({
        anchorUrl: form.anchorUrl.trim(),
        startSec,
        endSec,
        streamers: form.handles.map((handle) => ({ handle })),
        includeAnchor: form.includeAnchor,
      })
      // Seed per-POV chat choice from the Setup default; the Review screen's
      // chat pills let the user override per creator.
      setAnalysis({
        ...result,
        povs: result.povs.map((p) => (p.platform === 'twitch' ? { ...p, chatSelected: form.chat } : p)),
      })
      setProgress({})
      setXmlPath(undefined)
      setStage('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong analyzing this VOD.')
    } finally {
      setAnalyzing(false)
    }
  }

  const toggle = (target: POVResult) => {
    if (!analysis) return
    setAnalysis({
      ...analysis,
      povs: analysis.povs.map((p) =>
        p.handle === target.handle && p.platform === target.platform ? { ...p, selected: !p.selected } : p,
      ),
    })
  }

  const toggleChat = (target: POVResult) => {
    if (!analysis) return
    setAnalysis({
      ...analysis,
      povs: analysis.povs.map((p) =>
        p.handle === target.handle && p.platform === target.platform ? { ...p, chatSelected: !p.chatSelected } : p,
      ),
    })
  }

  // Remember collaborators that produced a clip so the roster suggestions fill
  // themselves in over time (entries keyed by platform:handle, newest first).
  const rememberStreamers = (povs: POVResult[]) => {
    const fresh = povs
      .filter((p) => p.outputFile)
      .map((p) => ({
        id: `${p.platform}:${p.handle.toLowerCase()}`,
        displayName: p.displayName,
        ...(p.platform === 'twitch' ? { twitch: p.handle } : { youtube: p.handle }),
      }))
    if (fresh.length === 0) return
    setRoster((prev) => {
      const seen = new Set(fresh.map((e) => e.id))
      const merged = [...fresh, ...prev.filter((e) => !seen.has(e.id))].slice(0, 50)
      void api.saveRoster(merged).catch(() => {})
      return merged
    })
  }

  const runDownload = async () => {
    if (!analysis) return
    const myJob = ++jobIdRef.current
    setError(undefined)
    setExportError(undefined)
    setStage('downloading')
    setProgress({})
    try {
      const povs = await api.download({
        analysis,
        options: { outDir: form.outDir, quality: form.quality, padSec: 4, filenamePrefix: 'LivestreamSync', chat: form.chat },
      })
      if (jobIdRef.current !== myJob) return // superseded by a cancel/new job
      const updated = { ...analysis, povs: [...povs] }
      setAnalysis(updated)
      setStage('done')
      rememberStreamers(povs)
      if (form.exportXml) void runExport(updated)
    } catch (e) {
      if (jobIdRef.current !== myJob) return
      setError(e instanceof Error ? e.message : 'Download failed.')
      setStage('review')
    }
  }

  const runExport = async (a?: Analysis) => {
    const target = a ?? analysisRef.current
    if (!target) return
    setExporting(true)
    setExportError(undefined)
    try {
      const path = await api.exportTimeline({ analysis: target, outDir: form.outDir })
      setXmlPath(path)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Timeline export failed.')
    } finally {
      setExporting(false)
    }
  }

  // Downloads land in a per-session subfolder now — "Open folder" should open
  // that, not the root. Derived from any clip path (no node:path in renderer).
  const sessionDir = (): string => {
    const f = analysisRef.current?.povs.find((p) => p.outputFile)?.outputFile
    if (!f) return form.outDir
    const cut = Math.max(f.lastIndexOf('\\'), f.lastIndexOf('/'))
    return cut > 0 ? f.slice(0, cut) : form.outDir
  }

  const newJob = () => {
    setStage('setup')
    setAnalysis(null)
    setProgress({})
    setXmlPath(undefined)
    setError(undefined)
    setExportError(undefined)
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg text-ink">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 grid-fade opacity-60" />
      <TitleBar />
      <main className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="h-full overflow-y-auto"
          >
            {stage === 'setup' && (
              <Setup
                form={form}
                setForm={setForm}
                roster={roster}
                onAnalyze={runAnalyze}
                analyzing={analyzing}
                error={error}
                warning={toolWarning}
              />
            )}
            {stage === 'review' && analysis && (
              <Review
                analysis={analysis}
                error={error}
                onBack={() => {
                  setError(undefined) // an analyze/download error must not resurface on the Setup form
                  setStage('setup')
                }}
                onToggle={toggle}
                onToggleChat={toggleChat}
                onDownload={runDownload}
              />
            )}
            {(stage === 'downloading' || stage === 'done') && analysis && (
              <Progress
                analysis={analysis}
                progress={progress}
                done={stage === 'done'}
                xmlPath={xmlPath}
                exporting={exporting}
                exportError={exportError}
                onExport={() => runExport()}
                onOpenFolder={() => api.openFolder(sessionDir())}
                onReveal={(f) => api.revealFile(f)}
                onNewJob={newJob}
                onCancel={() => {
                  jobIdRef.current++ // invalidate the in-flight job's continuation
                  api.cancel()
                  setStage('review')
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
