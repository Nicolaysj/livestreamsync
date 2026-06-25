import { useState, type KeyboardEvent } from 'react'
import { X, Plus, Users } from 'lucide-react'
import { inferPlatform } from '../../engine/src/validate'
import type { RosterEntry } from '../../engine/src/types'
import { PlatformIcon } from './bits'

export function StreamerInput({
  handles,
  onChange,
  roster,
}: {
  handles: string[]
  onChange: (h: string[]) => void
  roster: RosterEntry[]
}) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const tokens = raw
      .split(/[,\s]+/)
      .map((t) => t.trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/^https?:\/\/(www\.)?youtube\.com\//i, ''))
      .filter(Boolean)
    const next = [...handles]
    for (const t of tokens) {
      if (!next.some((h) => h.toLowerCase() === t.toLowerCase())) next.push(t)
    }
    onChange(next)
    setDraft('')
  }

  const remove = (h: string) => onChange(handles.filter((x) => x !== h))

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim()) add(draft)
    } else if (e.key === 'Backspace' && !draft && handles.length) {
      remove(handles[handles.length - 1])
    }
  }

  const rosterSuggestions = roster.filter((r) => {
    const h = r.twitch || r.youtube
    return h && !handles.some((x) => x.toLowerCase() === h.toLowerCase())
  })

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">Streamers to sync</span>
      <div className="no-drag flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-bg-2 p-2 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/20">
        {handles.map((h) => (
          <span
            key={h}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] py-1 pl-2 pr-1 text-sm text-ink"
          >
            <PlatformIcon platform={inferPlatform(h)} className="h-3.5 w-3.5" />
            {h}
            <button onClick={() => remove(h)} className="rounded p-0.5 text-faint hover:bg-white/10 hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={handles.length ? 'Add another…' : 'Type a handle and press Enter (e.g. pokimane, @sydeon)'}
          className="min-w-[180px] flex-1 bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-faint"
        />
      </div>

      {rosterSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-xs text-faint">
            <Users className="h-3.5 w-3.5" /> Roster:
          </span>
          {rosterSuggestions.map((r) => {
            const h = (r.twitch || r.youtube)!
            return (
              <button
                key={r.id}
                onClick={() => add(h)}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-panel/60 px-2 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
              >
                <Plus className="h-3 w-3" />
                {r.displayName}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
