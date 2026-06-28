import { Minus, Square, X } from 'lucide-react'
import { api } from '../lib/api'
import { Logo } from './bits'

export function TitleBar() {
  return (
    <header className="app-drag relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div className="flex items-center gap-2.5 pl-1">
        <Logo />
        <span className="text-[13px] font-semibold tracking-tight text-ink">
          Livestream<span className="text-accent-2">Sync</span>
        </span>
      </div>
      <div className="no-drag flex items-center gap-1">
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
      </div>
    </header>
  )
}
