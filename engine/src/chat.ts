// Twitch VOD chat download for a clip's exact (padded) window — native GQL, no
// extra binaries. Emits TwitchDownloader-compatible chat JSON (the de-facto
// interchange format, so users can render an overlay with TwitchDownloaderCLI
// later) plus a simple .srt with timestamps re-based to the clip.
//
// yt-dlp cannot do this: its Twitch chat support was removed in 2026-06 when
// the old v5 comments endpoint died. Everything below rides the same public
// GQL endpoint (and Client-ID) the discovery queries in twitch.ts already use.

import { writeFile } from 'node:fs/promises'
import { clampFinite } from './validate.js'
import type { DownloadOptions, ResolvedSegment } from './types.js'

const GQL_URL = 'https://gql.twitch.tv/gql'
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
// Fallback path: the persisted query TwitchDownloader uses (see its
// ChatDownloader.cs — treat that file as the canary if Twitch rotates these).
const PERSISTED_CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp'
const PERSISTED_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a'

const MAX_PAGES = 4000 // safety cap (~200k comments) — far above any real clip window

export interface ChatResult {
  jsonFile: string
  srtFile: string
  commentCount: number
}

interface ChatNode {
  id: string
  createdAt: string
  contentOffsetSeconds: number
  commenter: { id: string; login: string; displayName: string } | null
  message: {
    userColor: string | null
    fragments: { text: string; emote: { emoteID?: string; id?: string } | null }[]
    userBadges: { setID: string; version: string }[]
  } | null
}

interface CommentsPage {
  edges: { cursor: string; node: ChatNode }[]
  pageInfo: { hasNextPage: boolean }
}

const COMMENTS_QUERY = `query VideoComments($videoID: ID!, $offset: Int, $cursor: Cursor) {
  video(id: $videoID) {
    id
    owner { id login displayName }
    comments(contentOffsetSeconds: $offset, after: $cursor) {
      edges { cursor node {
        id createdAt contentOffsetSeconds
        commenter { id login displayName }
        message {
          userColor
          fragments { text emote { emoteID } }
          userBadges { setID version }
        }
      } }
      pageInfo { hasNextPage }
    }
  }
}`

interface PageResult {
  page: CommentsPage | null
  owner: { id: string; login: string; displayName: string } | null
}

async function fetchPage(
  videoID: string,
  vars: { offset?: number; cursor?: string },
  signal: AbortSignal | undefined,
): Promise<PageResult> {
  // Primary: arbitrary query (same style as twitch.ts — no fragile hash).
  // Fallback: TwitchDownloader's persisted query, in case Twitch ever stops
  // accepting arbitrary comment queries on the web Client-ID.
  const attempts: { body: string; clientId: string }[] = [
    {
      clientId: WEB_CLIENT_ID,
      body: JSON.stringify({
        query: COMMENTS_QUERY,
        variables: { videoID, offset: vars.offset ?? null, cursor: vars.cursor ?? null },
      }),
    },
    {
      clientId: PERSISTED_CLIENT_ID,
      body: JSON.stringify({
        operationName: 'VideoCommentsByOffsetOrCursor',
        variables: vars.cursor != null ? { videoID, cursor: vars.cursor } : { videoID, contentOffsetSeconds: vars.offset ?? 0 },
        extensions: { persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH } },
      }),
    },
  ]

  let lastErr: unknown
  for (const attempt of attempts) {
    try {
      const res = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': attempt.clientId, 'Content-Type': 'application/json' },
        body: attempt.body,
        signal: signal ?? AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`Twitch GraphQL HTTP ${res.status}`)
      const json = (await res.json()) as {
        data?: { video?: { owner?: PageResult['owner']; comments?: CommentsPage } | null }
        errors?: unknown
      }
      if (json.errors) throw new Error(`Twitch GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`)
      const video = json.data?.video
      if (!video) throw new Error('Video not found (deleted or sub-only chat).')
      return { page: video.comments ?? null, owner: video.owner ?? null }
    } catch (err) {
      lastErr = err
      if (signal?.aborted) throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Chat fetch failed.')
}

function msToSrtTime(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rem = ms % 1000
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(rem, 3)}`
}

function messageBody(node: ChatNode): string {
  return (node.message?.fragments ?? [])
    .map((f) => f.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Download the chat for a segment's padded window and write it next to the clip
 * as `<clip>.chat.json` (TwitchDownloader-compatible) and `<clip>.chat.srt`
 * (timestamps re-based to the clip, so it drops onto the clip as captions).
 */
export async function downloadChat(
  seg: ResolvedSegment,
  displayName: string,
  clipFile: string,
  opts: DownloadOptions,
  signal?: AbortSignal,
): Promise<ChatResult> {
  if (seg.platform !== 'twitch') throw new Error('Chat download is Twitch-only for now.')

  // Mirror downloadSegment's window math exactly, so chat covers the padded clip.
  const pad = clampFinite(opts.padSec ?? 4, 0, 60)
  const startSec = Math.max(0, seg.offsetSec - pad)
  const endSec = seg.offsetSec + seg.windowLenSec + pad

  const nodes: ChatNode[] = []
  let owner: PageResult['owner'] = null
  let cursor: string | undefined
  let pages = 0

  while (pages < MAX_PAGES) {
    if (signal?.aborted) throw new Error('Cancelled')
    const { page, owner: pageOwner } = await fetchPage(
      seg.vodId,
      cursor ? { cursor } : { offset: Math.floor(startSec) },
      signal,
    )
    owner ??= pageOwner
    pages++
    const edges = page?.edges ?? []
    if (edges.length === 0) break
    for (const e of edges) {
      const off = e.node.contentOffsetSeconds
      if (off >= startSec && off <= endSec && e.node.message) nodes.push(e.node)
    }
    const lastOff = edges[edges.length - 1].node.contentOffsetSeconds
    if (lastOff > endSec || !page?.pageInfo?.hasNextPage) break
    cursor = edges[edges.length - 1].cursor
    if (!cursor) break
  }

  const base = clipFile.replace(/\.mp4$/i, '')
  const jsonFile = `${base}.chat.json`
  const srtFile = `${base}.chat.srt`

  // TwitchDownloader "ChatRoot" schema (subset) — enough for chatrender/chatupdate.
  const chatJson = {
    FileInfo: { Version: { Major: 1, Minor: 4, Patch: 0 }, CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() },
    streamer: { name: owner?.displayName || displayName, id: Number(owner?.id) || 0 },
    video: {
      title: seg.title,
      id: seg.vodId,
      created_at: new Date(seg.vodStartMs).toISOString(),
      start: startSec,
      end: endSec,
      length: seg.durationSec,
      viewCount: 0,
      game: '',
    },
    comments: nodes.map((n) => ({
      _id: n.id,
      created_at: n.createdAt,
      channel_id: owner?.id ?? '',
      content_type: 'video',
      content_id: seg.vodId,
      content_offset_seconds: n.contentOffsetSeconds,
      commenter: {
        display_name: n.commenter?.displayName ?? 'deleted user',
        _id: n.commenter?.id ?? '',
        name: n.commenter?.login ?? '',
        bio: '',
        created_at: '',
        updated_at: '',
        logo: '',
      },
      message: {
        body: messageBody(n),
        bits_spent: 0,
        fragments: (n.message?.fragments ?? []).map((f) => ({
          text: f.text,
          emoticon: f.emote ? { emoticon_id: f.emote.emoteID ?? f.emote.id ?? '' } : null,
        })),
        user_badges: (n.message?.userBadges ?? [])
          .filter((b) => b.setID)
          .map((b) => ({ _id: b.setID, version: b.version })),
        user_color: n.message?.userColor ?? null,
        emoticons: [],
      },
    })),
    embeddedData: null,
  }

  // SRT re-based to the clip: cue time = VOD offset minus where the clip starts.
  const CUE_MS = 4000
  const srt = nodes
    .map((n, i) => {
      const t0 = (n.contentOffsetSeconds - startSec) * 1000
      const who = n.commenter?.displayName ?? 'deleted user'
      return `${i + 1}\n${msToSrtTime(t0)} --> ${msToSrtTime(t0 + CUE_MS)}\n${who}: ${messageBody(n)}\n`
    })
    .join('\n')

  await writeFile(jsonFile, JSON.stringify(chatJson, null, 1), 'utf8')
  await writeFile(srtFile, srt, 'utf8')
  return { jsonFile, srtFile, commentCount: nodes.length }
}
