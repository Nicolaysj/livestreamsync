import type { POVStatus } from '../../engine/src/types'

export { secToTimecode, parseTimecodeToSec, parseTParam } from '../../engine/src/time'

export function fmtBytes(n?: number): string {
  if (!n) return ''
  const mb = n / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`
}

export type Tone = 'ok' | 'warn' | 'muted' | 'danger' | 'info'

export interface StatusMeta {
  label: string
  tone: Tone
  /** true when this POV produces a downloadable clip */
  downloadable: boolean
}

export const STATUS_META: Record<POVStatus, StatusMeta> = {
  covered: { label: 'Ready', tone: 'ok', downloadable: true },
  partial: { label: 'Partial', tone: 'warn', downloadable: true },
  gap: { label: 'No VOD for this window', tone: 'muted', downloadable: false },
  'no-vods': { label: 'No VODs on channel', tone: 'muted', downloadable: false },
  'sub-only': { label: 'Subscriber-only', tone: 'warn', downloadable: false },
  processing: { label: 'Still processing', tone: 'warn', downloadable: false },
  error: { label: 'Error', tone: 'danger', downloadable: false },
}

export const TONE_CLASS: Record<Tone, { text: string; bg: string; dot: string }> = {
  ok: { text: 'text-ok', bg: 'bg-ok/10', dot: 'bg-ok' },
  warn: { text: 'text-warn', bg: 'bg-warn/10', dot: 'bg-warn' },
  muted: { text: 'text-muted', bg: 'bg-white/5', dot: 'bg-faint' },
  danger: { text: 'text-danger', bg: 'bg-danger/10', dot: 'bg-danger' },
  info: { text: 'text-info', bg: 'bg-info/10', dot: 'bg-info' },
}
