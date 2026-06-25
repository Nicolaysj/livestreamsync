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
}

export default function App() {
  const [stage, setStage] = useState<Stage>('setup')
  const [form, setForm] = useState<SetupForm>(DEFAULT_FORM)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [progress, setProgress] = useState<Record<string, ProgressEvent>>({})
  const [exporting, setExporting] = useState(false)
  const [xmlPath, setXmlPath] = useState<string | undefined>()
  const analysisRef = useRef<Analysis | null>(null)
  analysisRef.current = analysis
  const cancelledRef = useRef(false)

  useEffect(() => {
    api.getRoster().then(setRoster).catch(() => {})
    api.getDefaults().then((d) => setForm((f) => (f.outDir ? f : { ...f, outDir: d.outDir }))).catch(() => {})
    const off = api.onProgress((ev) => setProgress((prev) => ({ ...prev, [`${ev.platform}:${ev.handle}`]: ev })))
    return off
  }, [])

  const runAnalyze = async () => {
    setError(undefined)
    let startSec: number
    let endSec: number
    try {
      startSec = parseTimecodeToSec(form.start)
      endSec = parseTimecodeToSec(form.stop)
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
      setAnalysis(result)
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

  const runDownload = async () => {
    if (!analysis) return
    cancelledRef.current = false
    setStage('downloading')
    setProgress({})
    try {
      const povs = await api.download({
        analysis,
        options: { outDir: form.outDir, quality: form.quality, padSec: 4, filenamePrefix: 'POVsync' },
      })
      if (cancelledRef.current) return // user cancelled mid-flight; stay on review
      const updated = { ...analysis, povs: [...povs] }
      setAnalysis(updated)
      setStage('done')
      if (form.exportXml) void runExport(updated)
    } catch (e) {
      if (cancelledRef.current) return
      setError(e instanceof Error ? e.message : 'Download failed.')
      setStage('review')
    }
  }

  const runExport = async (a?: Analysis) => {
    const target = a ?? analysisRef.current
    if (!target) return
    setExporting(true)
    try {
      const path = await api.exportTimeline({ analysis: target, outDir: form.outDir })
      setXmlPath(path)
    } catch {
      /* keep silent — non-fatal */
    } finally {
      setExporting(false)
    }
  }

  const newJob = () => {
    setStage('setup')
    setAnalysis(null)
    setProgress({})
    setXmlPath(undefined)
    setError(undefined)
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
              <Setup form={form} setForm={setForm} roster={roster} onAnalyze={runAnalyze} analyzing={analyzing} error={error} />
            )}
            {stage === 'review' && analysis && (
              <Review analysis={analysis} onBack={() => setStage('setup')} onToggle={toggle} onDownload={runDownload} />
            )}
            {(stage === 'downloading' || stage === 'done') && analysis && (
              <Progress
                analysis={analysis}
                progress={progress}
                done={stage === 'done'}
                xmlPath={xmlPath}
                exporting={exporting}
                onExport={() => runExport()}
                onOpenFolder={() => api.openFolder(form.outDir)}
                onReveal={(f) => api.revealFile(f)}
                onNewJob={newJob}
                onCancel={() => {
                  cancelledRef.current = true
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
