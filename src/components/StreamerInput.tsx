import { useState, type KeyboardEvent } from 'react'
import { X, Plus, Users } from 'lucide-react'
import { inferPlatform, isValidTwitchLogin, isValidYouTubeHandle } from '../../engine/src/validate'
import type { RosterEntry } from '../../engine/src/types'
import { PlatformIcon } from './bits'

// Pasting a *video* link here is the single most likely mistake in a VOD tool —
// catch it up front instead of letting "videos/123456789" fail lookup later.
const VIDEO_URL_RE = /^https?:\/\/((www\.|m\.)?twitch\.tv\/videos\/|(www\.|m\.)?youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i
const CHANNEL_URL_RE = /^https?:\/\/(www\.|m\.)?(twitch\.tv|youtube\.com)\/(@)?/i

/** "https://twitch.tv/name?x=1" / "youtube.com/@name/videos" → "name" / "@name". */
function extractHandle(token: string): string {
  if (!CHANNEL_URL_RE.test(token)) return token
  const keepAt = /youtube\.com\/@/i.test(token)
  const rest = token.replace(CHANNEL_URL_RE, '').replace(/^(c|channel|user)\//i, '')
  const first = rest.split(/[/?#]/)[0]
  return keepAt ? `@${first}` : first
}

function isPlausibleHandle(h: string): boolean {
  // Raw form also covers pasted UC… channel ids, which must not get an '@' prefix.
  return isValidTwitchLogin(h) || isValidYouTubeHandle(h) || (!h.startsWith('@') && isValidYouTubeHandle(`@${h}`))
}

const VISIBLE_ROSTER = 8

export function StreamerInput({
  handles,
  onChange,
  roster,
  onRemoveRoster,
}: {
  handles: string[]
  onChange: (h: string[]) => void
  roster: RosterEntry[]
  onRemoveRoster: (id: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | undefined>()
  const [showAllRoster, setShowAllRoster] = useState(false)

  const add = (raw: string) => {
    const tokens = raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
    const next = [...handles]
    let problem: string | undefined
    for (const t of tokens) {
      if (VIDEO_URL_RE.test(t)) {
        problem = 'That looks like a video link — it belongs in the Anchor VOD field. Add streamers here by channel handle (e.g. pokimane or @sydeon).'
        continue
      }
      const h = extractHandle(t)
      if (!h || !isPlausibleHandle(h)) {
        problem = `“${t}” doesn’t look like a Twitch login or YouTube handle.`
        continue
      }
      if (!next.some((x) => x.toLowerCase() === h.toLowerCase())) next.push(h)
    }
    setHint(problem)
    onChange(next)
    setDraft(problem ? raw : '')
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-2 py-1 pl-2 pr-1 text-sm text-ink"
          >
            <PlatformIcon platform={inferPlatform(h)} className="h-3.5 w-3.5" />
            {h}
            <button onClick={() => remove(h)} className="rounded p-0.5 text-faint hover:bg-border-2 hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setHint(undefined)
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={handles.length ? 'Add another…' : 'Type a handle and press Enter (e.g. pokimane, @sydeon)'}
          className="min-w-[180px] flex-1 bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-faint"
        />
      </div>

      {hint && <p className="mt-1.5 text-xs text-warn">{hint}</p>}

      {rosterSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-xs text-faint">
            <Users className="h-3.5 w-3.5" /> Roster:
          </span>
          {(showAllRoster ? rosterSuggestions : rosterSuggestions.slice(0, VISIBLE_ROSTER)).map((r) => {
            const h = (r.twitch || r.youtube)!
            return (
              // Hover reveals a remove control; the chip itself still adds.
              <span key={r.id} className="group relative inline-flex">
                <button
                  onClick={() => add(h)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-panel/60 px-2 py-1 text-xs text-muted transition-all hover:border-accent/40 hover:text-ink group-hover:pr-6"
                >
                  <Plus className="h-3 w-3" />
                  {r.displayName}
                </button>
                <button
                  onClick={() => onRemoveRoster(r.id)}
                  title={`Remove ${r.displayName} from roster`}
                  aria-label={`Remove ${r.displayName} from roster`}
                  className="absolute right-1 top-1/2 hidden h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-faint hover:text-danger group-hover:flex"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
          {!showAllRoster && rosterSuggestions.length > VISIBLE_ROSTER && (
            <button
              onClick={() => setShowAllRoster(true)}
              className="rounded-lg px-1.5 py-1 text-xs text-faint transition-colors hover:text-ink"
            >
              +{rosterSuggestions.length - VISIBLE_ROSTER} more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
