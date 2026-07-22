import { Minus, Square, X, Coffee } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'
import { Logo } from './bits'
import { UpdatesMenu } from './UpdatesMenu'

export function TitleBar() {
  // On macOS the OS draws native traffic lights at the top-left, so we hide our custom
  // window buttons and pad the logo clear of the lights. Windows keeps the custom controls.
  const isMac = api.platform === 'darwin'
  return (
    <header className="app-drag relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div className={clsx('flex items-center gap-2.5', isMac ? 'pl-[78px]' : 'pl-1')}>
        <Logo />
        <span className="text-[13px] font-semibold tracking-tight text-ink">
          Livestream<span className="text-accent-2">Sync</span>
        </span>
      </div>
      <div className="no-drag flex items-center gap-1">
        <button
          onClick={() => api.openKofi()}
          title="Buy me a coffee"
          aria-label="Buy me a coffee"
          className="flex h-7 w-8 items-center justify-center rounded-lg text-accent-2 transition-colors hover:bg-accent/15"
        >
          <Coffee className="h-4 w-4" />
        </button>
        <span className={isMac ? '' : 'mr-2'}>
          <UpdatesMenu />
        </span>
        {!isMac && (
          <>
            <button
              onClick={() => api.minimize()}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-ink"
              aria-label="Minimize"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={() => api.toggleMaximize()}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-ink"
              aria-label="Maximize"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => api.close()}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
