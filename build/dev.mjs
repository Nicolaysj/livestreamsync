// Dev launcher: build main/preload, start Vite, then launch Electron pointing at the dev server.
import { context } from 'esbuild'
import { spawn } from 'node:child_process'
import process from 'node:process'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

const mainCtx = await context({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
const preloadCtx = await context({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' })
await mainCtx.rebuild()
await preloadCtx.rebuild()
await mainCtx.watch()
await preloadCtx.watch()

const DEV_URL = 'http://localhost:5173'
const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'inherit', shell: true })

// Give Vite a moment, then launch Electron.
const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(DEV_URL)
      if (r.ok) return true
    } catch {}
    await new Promise((res) => setTimeout(res, 500))
  }
  return false
}

if (await waitForServer()) {
  const electron = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  })
  electron.on('close', () => {
    vite.kill()
    process.exit(0)
  })
} else {
  console.error('[dev] Vite dev server did not start')
  vite.kill()
  process.exit(1)
}
