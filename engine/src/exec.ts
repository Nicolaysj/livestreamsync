// Process execution helpers. SECURITY: we never use a shell. Commands run via
// child_process.spawn with an explicit argv array, so user-supplied values (URLs,
// handles, paths) can never be interpreted as shell syntax — no command injection.

import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  timeoutMs?: number
  cwd?: string
  maxBuffer?: number // cap captured output (bytes) to avoid memory blowups
}

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024 // 16 MB

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
  return new Promise((resolve, reject) => {
    // Detach on POSIX (as in stream()) so a timeout can kill the whole group —
    // yt-dlp may have already spawned ffmpeg even for metadata calls.
    const child = spawn(cmd, args, {
      shell: false,
      cwd: opts.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let killed = false
    let timer: NodeJS.Timeout | undefined

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        killed = true
        killTree(child)
      }, opts.timeoutMs)
    }

    // StringDecoder buffers multi-byte UTF-8 sequences split across chunks —
    // plain toString() would mangle titles/channel names into U+FFFD.
    const outDec = new StringDecoder('utf8')
    const errDec = new StringDecoder('utf8')
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxBuffer) stdout += outDec.write(d)
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < maxBuffer) stderr += errDec.write(d)
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (killed) return reject(new Error(`Process timed out after ${opts.timeoutMs}ms`))
      resolve({ code, stdout, stderr })
    })
  })
}

export interface StreamHandle {
  /** Promise that resolves with the exit code when the process ends. */
  done: Promise<number | null>
  /** Request cancellation (SIGTERM, then SIGKILL after a grace period). */
  cancel: () => void
}

/**
 * Spawn a process and invoke `onLine` for each line on stdout/stderr. Used for
 * long-running yt-dlp/ffmpeg jobs where we parse progress as it streams.
 */
/**
 * Kill a child AND its descendants. yt-dlp spawns ffmpeg, so signalling only the
 * direct child would orphan ffmpeg and leave a partial file. On Windows we use
 * `taskkill /T`; on POSIX we signal the detached process group.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid
  if (pid == null) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {})
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
    }, 4000).unref?.()
  }
}

export function stream(
  cmd: string,
  args: string[],
  onLine: (line: string, source: 'stdout' | 'stderr') => void,
  opts: RunOptions = {},
): StreamHandle {
  // Detach on POSIX so the whole process group can be killed; Windows uses taskkill /T.
  const detached = process.platform !== 'win32'
  const child = spawn(cmd, args, { shell: false, cwd: opts.cwd, windowsHide: true, detached })

  let lastActivity = Date.now()
  let stalled = false
  let watchdog: NodeJS.Timeout | undefined

  const wire = (src: 'stdout' | 'stderr') => {
    let buf = ''
    const dec = new StringDecoder('utf8')
    const s = src === 'stdout' ? child.stdout : child.stderr
    s.on('data', (d: Buffer) => {
      lastActivity = Date.now()
      buf += dec.write(d)
      // yt-dlp/ffmpeg use \r for in-place progress; treat both \r and \n as line breaks.
      const parts = buf.split(/\r\n|\r|\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) if (line.length) onLine(line, src)
    })
    s.on('close', () => {
      buf += dec.end()
      if (buf.length) onLine(buf, src)
    })
  }
  wire('stdout')
  wire('stderr')

  // Inactivity watchdog: if no output arrives for timeoutMs, the job is wedged — kill it.
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    const tick = Math.min(5000, opts.timeoutMs)
    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > opts.timeoutMs!) {
        stalled = true
        killTree(child)
      }
    }, tick)
    watchdog.unref?.()
  }

  const done = new Promise<number | null>((resolve, reject) => {
    child.on('error', (err) => {
      if (watchdog) clearInterval(watchdog)
      reject(err)
    })
    child.on('close', (code) => {
      if (watchdog) clearInterval(watchdog)
      if (stalled) reject(new Error('Download stalled — no output for too long.'))
      else resolve(code)
    })
  })

  const cancel = () => killTree(child)

  return { done, cancel }
}
