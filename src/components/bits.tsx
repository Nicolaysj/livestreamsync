import { clsx } from 'clsx'
import { Twitch, Youtube } from 'lucide-react'
import type { Platform, POVStatus } from '../../engine/src/types'
import { STATUS_META, TONE_CLASS } from '../lib/format'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="3" y="8" width="17" height="13" rx="3" fill="var(--color-accent)" opacity="0.4" />
      <rect x="7.5" y="5.5" width="17" height="13" rx="3" fill="var(--color-accent)" opacity="0.65" />
      <rect x="12" y="3" width="17" height="13" rx="3" fill="var(--color-accent-strong)" />
      <path d="M18 6.5 L25 9.5 L18 12.5 Z" fill="var(--color-accent-ink)" />
    </svg>
  )
}

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  return platform === 'youtube' ? (
    <Youtube className={clsx('text-youtube', className)} />
  ) : (
    <Twitch className={clsx('text-twitch', className)} />
  )
}

export function Avatar({
  src,
  name,
  platform,
  size = 40,
}: {
  src?: string
  name: string
  platform: Platform
  size?: number
}) {
  const initials = name.replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 2).toUpperCase() || '?'
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-accent-soft/40 to-panel-2 ring-1 ring-border"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted">
          {initials}
        </div>
      )}
      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg ring-2 ring-bg">
        <PlatformIcon platform={platform} className="h-2.5 w-2.5" />
      </span>
    </div>
  )
}

export function StatusChip({ status }: { status: POVStatus }) {
  const meta = STATUS_META[status]
  const tone = TONE_CLASS[meta.tone]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', tone.bg, tone.text)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {meta.label}
    </span>
  )
}
