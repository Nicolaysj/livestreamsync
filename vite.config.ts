import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// The renderer is a normal Vite + React app. It runs:
//   - standalone in a browser (`npm run dev:web`) for UI development/verification, and
//   - inside Electron (loaded from the dev server or the built `dist/`).
// `base: './'` makes the production build load assets via relative paths under file://.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@engine': resolve(__dirname, 'engine/src'),
    },
  },
})
