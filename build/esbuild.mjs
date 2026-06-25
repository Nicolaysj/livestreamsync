// Bundles the Electron main + preload (and the engine they import) into dist-electron/.
// CJS output so it loads regardless of the root package.json "type": "module".
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' })
console.log('[esbuild] main + preload built -> dist-electron/')
