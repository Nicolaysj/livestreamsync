// Twitch provider: discovery via the public GraphQL endpoint (fast — one request per
// channel returns archives with publishedAt + lengthSeconds), with a yt-dlp fallback.

import type { Tools } from './tools.js'
import { run } from './exec.js'
import { isoToMs } from './time.js'
import { isValidTwitchLogin, isValidTwitchVodId } from './validate.js'
import type { AnchorRef, VodRecord } from './types.js'
import type { Provider, POVResolution, ProviderContext } from './providers.js'

const GQL_URL = 'https://gql.twitch.tv/gql'
// The long-lived public web Client-ID. Used by countless tools; arbitrary (non-persisted)
// queries are accepted, which keeps us off fragile persisted-query hashes.
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

interface GqlVideoNode {
  id: string
  title: string
  lengthSeconds: number
  publishedAt: string
  broadcastType: string
}

async function twitchGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Client-ID': WEB_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Twitch GraphQL HTTP ${res.status}`)
    const json = (await res.json()) as { data?: T; errors?: unknown }
    if (json.errors) throw new Error(`Twitch GraphQL error: ${JSON.stringify(json.errors)}`)
    if (!json.data) throw new Error('Twitch GraphQL returned no data')
    return json.data
  } finally {
    clearTimeout(timer)
  }
}

const CHANNEL_QUERY = `query ChannelVideos($login: String!, $first: Int!) {
  user(login: $login) {
    id displayName login profileImageURL(width: 70)
    videos(first: $first, sort: TIME, type: ARCHIVE) {
      edges { node { id title lengthSeconds publishedAt broadcastType } }
    }
  }
}`

const VIDEO_QUERY = `query VideoInfo($id: ID!) {
  video(id: $id) {
    id title lengthSeconds publishedAt broadcastType
    owner { login displayName profileImageURL(width: 70) }
  }
}`

interface ChannelData {
  user: {
    id: string
    displayName: string
    login: string
    profileImageURL: string
    videos: { edges: { node: GqlVideoNode }[] }
  } | null
}

interface VideoData {
  video: (GqlVideoNode & {
    owner: { login: string; displayName: string; profileImageURL: string } | null
  }) | null
}

export class TwitchProvider implements Provider {
  readonly platform = 'twitch' as const
  constructor(private ctx: ProviderContext) {}

  private get tools(): Tools {
    return this.ctx.tools
  }

  async getAnchorInfo(vodId: string): Promise<AnchorRef> {
    if (!isValidTwitchVodId(vodId)) throw new Error('Invalid Twitch VOD id.')
    try {
      const data = await twitchGql<VideoData>(VIDEO_QUERY, { id: vodId })
      const v = data.video
      if (v && v.publishedAt && v.lengthSeconds) {
        return {
          url: `https://www.twitch.tv/videos/${vodId}`,
          platform: 'twitch',
          vodId,
          title: v.title || `Twitch VOD ${vodId}`,
          channel: v.owner?.displayName || v.owner?.login || 'Unknown',
          startMs: isoToMs(v.publishedAt),
          durationSec: v.lengthSeconds,
        }
      }
    } catch (err) {
      this.ctx.log?.(`twitch gql anchor failed, falling back to yt-dlp: ${String(err)}`)
    }
    return this.getAnchorInfoViaYtDlp(vodId)
  }

  private async getAnchorInfoViaYtDlp(vodId: string): Promise<AnchorRef> {
    const url = `https://www.twitch.tv/videos/${vodId}`
    const { code, stdout } = await run(
      this.tools.ytDlp,
      ['--no-warnings', '--print', '%(timestamp)s\t%(duration)s\t%(uploader)s\t%(title)s', url],
      { timeoutMs: 45_000 },
    )
    if (code !== 0) throw new Error('Could not read the anchor VOD. Is the link correct?')
    const [ts, dur, uploader, ...titleParts] = stdout.trim().split('\t')
    const startMs = Number(ts) * 1000
    if (!Number.isFinite(startMs) || startMs <= 0) throw new Error('Anchor VOD has no start time.')
    return {
      url,
      platform: 'twitch',
      vodId,
      title: titleParts.join('\t') || `Twitch VOD ${vodId}`,
      channel: uploader || 'Unknown',
      startMs,
      durationSec: Number(dur) || 0,
    }
  }

  async getUserMeta(login: string): Promise<{ displayName: string; avatarUrl?: string } | null> {
    if (!isValidTwitchLogin(login)) return null
    try {
      const data = await twitchGql<ChannelData>(CHANNEL_QUERY, { login, first: 1 })
      if (!data.user) return null
      return { displayName: data.user.displayName, avatarUrl: data.user.profileImageURL }
    } catch {
      return null
    }
  }

  private async listArchives(login: string): Promise<{ records: VodRecord[]; meta: { displayName: string; avatarUrl?: string } | null }> {
    const data = await twitchGql<ChannelData>(CHANNEL_QUERY, { login, first: 30 })
    if (!data.user) return { records: [], meta: null }
    const records: VodRecord[] = (data.user.videos?.edges ?? [])
      .map((e) => e.node)
      .filter((n) => n.broadcastType === 'ARCHIVE' && n.publishedAt && n.lengthSeconds)
      .map((n) => ({
        vodId: n.id,
        title: n.title,
        startMs: isoToMs(n.publishedAt),
        durationSec: n.lengthSeconds,
        subOnly: false, // detected at download time via 403
        processing: false,
      }))
    return { records, meta: { displayName: data.user.displayName, avatarUrl: data.user.profileImageURL } }
  }

  async resolveWindow(handle: string, win: { startMs: number; endMs: number; lengthSec: number }): Promise<POVResolution> {
    const login = handle.replace(/^.*\//, '').toLowerCase()
    if (!isValidTwitchLogin(login)) {
      return { status: 'error', reason: 'Not a valid Twitch handle.', displayName: handle }
    }

    let records: VodRecord[]
    let meta: { displayName: string; avatarUrl?: string } | null
    try {
      const res = await this.listArchives(login)
      records = res.records
      meta = res.meta
    } catch (err) {
      return { status: 'error', reason: 'Couldn’t reach Twitch (network or rate limit).', displayName: handle }
    }

    const displayName = meta?.displayName || handle
    const avatarUrl = meta?.avatarUrl
    if (records.length === 0) {
      return { status: 'no-vods', reason: 'This channel keeps no public VODs.', displayName, avatarUrl }
    }

    // Pick the archive with the largest overlap of the target window.
    let best: { rec: VodRecord; overlap: number } | null = null
    for (const rec of records) {
      const start = rec.startMs
      const end = rec.startMs + rec.durationSec * 1000
      const overlap = Math.min(end, win.endMs) - Math.max(start, win.startMs)
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { rec, overlap }
    }

    if (!best) {
      return { status: 'gap', reason: 'They have VODs, but none cover this moment.', displayName, avatarUrl }
    }

    const { rec } = best
    const start = rec.startMs
    const end = start + rec.durationSec * 1000
    const fullyCovers = start <= win.startMs && end >= win.endMs
    const offsetSec = Math.max(0, (win.startMs - start) / 1000)
    const leadingGapSec = Math.max(0, (start - win.startMs) / 1000)
    const sliceEndMs = Math.min(end, win.endMs)
    const sliceStartMs = Math.max(start, win.startMs)
    const windowLenSec = Math.max(0, (sliceEndMs - sliceStartMs) / 1000)

    return {
      status: fullyCovers ? 'covered' : 'partial',
      displayName,
      avatarUrl,
      reason: fullyCovers ? undefined : 'Joined partway through this window.',
      segment: {
        platform: 'twitch',
        vodId: rec.vodId,
        url: `https://www.twitch.tv/videos/${rec.vodId}`,
        title: rec.title,
        vodStartMs: start,
        durationSec: rec.durationSec,
        offsetSec,
        windowLenSec,
        leadingGapSec,
        trust: 'tight',
        subOnly: false,
      },
    }
  }
}
